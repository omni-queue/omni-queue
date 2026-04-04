import { QueueConfig } from '../interfaces/queue-config';
import { QueueStorage } from '../interfaces/queue-storage';
import { WorkerConfig } from '../interfaces/worker-config';
import { StoredJob } from '../types';
import { RateLimitCoordinator } from './rate-limiter';
import { JobManager } from './worker-runtime';
import type { LifecycleEventInput } from './lifecycle-events';
import { sleep } from '../utils';

export class ResilientWorker {
  private running = false;
  private idleBackoffMs = 1;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private idleResolve?: () => void;
  private rateLimits = new RateLimitCoordinator();
  private backpressureActive = new Map<string, boolean>();
  private circuitState = new Map<
    string,
    {
      status: 'closed' | 'open' | 'half-open';
      consecutiveFailures: number;
      openUntil?: number;
      halfOpenInFlight: number;
    }
  >();

  constructor(
    private name: string,
    private config: WorkerConfig,
    private runtime: JobManager,
    private storageAdapters: Record<string, QueueStorage>,
    private queues: Record<string, QueueConfig>,
    private canProcessQueue?: (queueName: string) => boolean,
    private emitLifecycleEvent?: (event: LifecycleEventInput) => void
  ) {}

  async start() {
    this.running = true;
    this.loop();
  }

  async loop() {
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        console.error(`[Worker ${this.name}] crashed`, err);

        await sleep(1000); // restart delay
      }
    }
  }

  async tick() {
    const queueOrder = this.getQueueOrder();
    const perQueueProcessed = await Promise.all(
      queueOrder.map(async (queueName) => {
        if (this.canProcessQueue && !this.canProcessQueue(queueName)) {
          return false;
        }

        const queueConfig = this.queues[queueName];
        if (!queueConfig) {
          return false;
        }

        if (!(await this.checkBackpressure(queueName, queueConfig))) {
          return false;
        }

        if (!this.canExecuteByCircuitBreaker(queueName, queueConfig)) {
          return false;
        }

        if (!(await this.canConsumeByRateLimit(queueName, queueConfig))) {
          return false;
        }

        const storage = this.storageAdapters[queueConfig.connection];
        if (!storage) {
          return false;
        }

        const jobs = await storage.dequeue({
          queue: queueName,
          batchSize: queueConfig.batchSize || 1,
          leaseMs: queueConfig.visibilityTimeout || 30000,
        });

        if (jobs.length === 0) {
          return false;
        }

        const results = await Promise.allSettled(
          jobs.map((job: StoredJob) => this.runtime.execute(job))
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            this.onExecutionSucceeded(queueName);
            continue;
          }

          this.onExecutionFailed(queueName, queueConfig, result.reason);
        }

        return true;
      })
    );

    const processedAnyJobs = perQueueProcessed.some(Boolean);
    if (processedAnyJobs) {
      this.idleBackoffMs = 1;
      return;
    }

    await this.waitForIdle(this.idleBackoffMs);
    this.idleBackoffMs = Math.min(this.idleBackoffMs * 2, 10);
  }

  private waitForIdle(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        if (this.idleTimer) {
          clearTimeout(this.idleTimer);
          this.idleTimer = undefined;
        }
        this.idleResolve = undefined;
        resolve();
      };

      this.idleResolve = finish;
      this.idleTimer = setTimeout(finish, delayMs);
    });
  }

  wake(queueName?: string): void {
    if (queueName && !this.config.queues.includes(queueName)) {
      return;
    }

    this.idleBackoffMs = 1;
    this.idleResolve?.();
  }

  private async checkBackpressure(queueName: string, queueConfig: QueueConfig): Promise<boolean> {
    const strategy = queueConfig.reliability?.backpressure;
    if (!strategy) {
      return true;
    }

    const storage = this.storageAdapters[queueConfig.connection];
    if (!storage) {
      return false;
    }

    const depth = await storage.getQueueDepth(queueName);
    const depthThreshold = Math.max(1, strategy.depthThreshold);
    const resumeThreshold = strategy.resumeThreshold ?? Math.max(0, Math.floor(depthThreshold / 2));
    const mode = strategy.mode ?? 'delay';
    const checkIntervalMs = strategy.checkIntervalMs ?? 1000;

    if (depth <= depthThreshold) {
      if (this.backpressureActive.get(queueName) === true) {
        this.backpressureActive.set(queueName, false);
        this.emitLifecycleEvent?.({
          type: 'queue.backpressure.cleared',
          queueName,
          queueDepth: depth,
          threshold: depthThreshold,
        });
      }
      return true;
    }

    if (this.backpressureActive.get(queueName) !== true) {
      this.backpressureActive.set(queueName, true);
      this.emitLifecycleEvent?.({
        type: 'queue.backpressure',
        queueName,
        queueDepth: depth,
        threshold: depthThreshold,
      });
    }

    if (mode === 'delay') {
      await sleep(checkIntervalMs);
      const refreshedDepth = await storage.getQueueDepth(queueName);
      return refreshedDepth <= Math.max(depthThreshold, resumeThreshold);
    }

    return false;
  }

  private canExecuteByCircuitBreaker(queueName: string, queueConfig: QueueConfig): boolean {
    const breaker = queueConfig.reliability?.circuitBreaker;
    if (!breaker) {
      return true;
    }

    const state = this.circuitState.get(queueName) ?? {
      status: 'closed' as const,
      consecutiveFailures: 0,
      halfOpenInFlight: 0,
    };

    if (state.status === 'open') {
      const now = Date.now();
      if ((state.openUntil ?? 0) > now) {
        return false;
      }

      state.status = 'half-open';
      state.halfOpenInFlight = 0;
      this.circuitState.set(queueName, state);
      this.emitLifecycleEvent?.({
        type: 'queue.circuit.changed',
        queueName,
        circuitState: 'half-open',
      });
    }

    if (state.status === 'half-open') {
      const maxInFlight = Math.max(1, breaker.halfOpenMaxInFlight ?? 1);
      if (state.halfOpenInFlight >= maxInFlight) {
        return false;
      }

      state.halfOpenInFlight += 1;
      this.circuitState.set(queueName, state);
      return true;
    }

    return true;
  }

  private async canConsumeByRateLimit(queueName: string, queueConfig: QueueConfig): Promise<boolean> {
    if (!queueConfig.rateLimit) {
      return true;
    }

    const storage = this.storageAdapters[queueConfig.connection];
    const consumerId = this.config.consumerId ?? this.name;

    if (storage?.consumeRateLimitToken) {
      return storage.consumeRateLimitToken({
        queueName,
        consumerId,
        queueCapacity: Math.max(1, queueConfig.rateLimit.capacity),
        queueRefillRate: Math.max(0, queueConfig.rateLimit.refillRate),
        ...(queueConfig.rateLimit.perConsumer
          ? {
              consumerCapacity: Math.max(1, queueConfig.rateLimit.perConsumer.capacity),
              consumerRefillRate: Math.max(0, queueConfig.rateLimit.perConsumer.refillRate),
            }
          : {}),
      });
    }

    return this.rateLimits.canConsume(queueName, consumerId, queueConfig);
  }

  private onExecutionSucceeded(queueName: string): void {
    const state = this.circuitState.get(queueName);
    if (!state) {
      return;
    }

    state.consecutiveFailures = 0;
    if (state.status === 'half-open') {
      state.status = 'closed';
      state.halfOpenInFlight = 0;
      delete state.openUntil;
      this.emitLifecycleEvent?.({
        type: 'queue.circuit.changed',
        queueName,
        circuitState: 'closed',
      });
    }

    this.circuitState.set(queueName, state);
  }

  private onExecutionFailed(queueName: string, queueConfig: QueueConfig, error: unknown): void {
    const breaker = queueConfig.reliability?.circuitBreaker;
    if (!breaker) {
      return;
    }

    if (breaker.tripOnTimeout === false && this.isTimeoutError(error)) {
      return;
    }

    const state = this.circuitState.get(queueName) ?? {
      status: 'closed' as const,
      consecutiveFailures: 0,
      halfOpenInFlight: 0,
    };

    state.consecutiveFailures += 1;
    if (state.status === 'half-open' || state.consecutiveFailures >= Math.max(1, breaker.failureThreshold)) {
      state.status = 'open';
      state.openUntil = Date.now() + Math.max(1_000, breaker.cooldownMs);
      state.halfOpenInFlight = 0;
      this.emitLifecycleEvent?.({
        type: 'queue.circuit.changed',
        queueName,
        circuitState: 'open',
      });
    }

    this.circuitState.set(queueName, state);
  }

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === 'JobTimeoutError' || /timeout/i.test(error.message);
  }

  getQueueOrder() {
    return [...this.config.queues].sort((a: string, b: string) => {
      const pa = this.queues[a]?.priority === 'high' ? 1 : 0;
      const pb = this.queues[b]?.priority === 'high' ? 1 : 0;

      return pb - pa;
    });
  }

  stop() {
    this.running = false;
    this.idleResolve?.();
  }
}
