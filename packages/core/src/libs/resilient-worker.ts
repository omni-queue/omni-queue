import { QueueConfig } from '../interfaces/queue-config';
import { QueueStorage } from '../interfaces/queue-storage';
import { WorkerConfig } from '../interfaces/worker-config';
import { RateLimitCoordinator } from './rate-limiter';
import { JobManager } from './worker-runtime';
import type { LifecycleEventInput } from './lifecycle-events';

export class ResilientWorker {
  private running = false;
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

    for (const queueName of queueOrder) {
      if (this.canProcessQueue && !this.canProcessQueue(queueName)) {
        continue;
      }

      const queueConfig = this.queues[queueName];
      if (!queueConfig) {
        continue;
      }

      if (!(await this.checkBackpressure(queueName, queueConfig))) {
        continue;
      }

      if (!this.canExecuteByCircuitBreaker(queueName, queueConfig)) {
        continue;
      }

      if (!this.canConsumeByRateLimit(queueName, queueConfig)) {
        continue;
      }

      const storage = this.storageAdapters[queueConfig.connection];
      if (!storage) {
        continue;
      }

      const jobs = await storage.dequeue({
        queue: queueName,
        batchSize: 1,
        leaseMs: queueConfig.visibilityTimeout || 30000,
      });

      for (const job of jobs) {
        try {
          await this.runtime.execute(job);
          this.onExecutionSucceeded(queueName);
        } catch (error) {
          this.onExecutionFailed(queueName, queueConfig, error);
        }
      }
    }
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

  private canConsumeByRateLimit(queueName: string, queueConfig: QueueConfig): boolean {
    if (!queueConfig.rateLimit) {
      return true;
    }

    const consumerId = this.config.consumerId ?? this.name;
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
    return this.config.queues.sort((a: string, b: string) => {
      const pa = this.queues[a]?.priority === 'high' ? 1 : 0;
      const pb = this.queues[b]?.priority === 'high' ? 1 : 0;

      return pb - pa;
    });
  }

  stop() {
    this.running = false;
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
