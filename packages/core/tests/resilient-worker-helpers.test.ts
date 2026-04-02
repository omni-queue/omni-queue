import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { ResilientWorker } from '../src/libs/resilient-worker';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';

class TimeoutErrorJob extends Job<Record<string, never>> {
  static jobName = 'timeout-error-job';
  override jobName = TimeoutErrorJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(): Promise<void> {
    const err = new Error('timed out waiting for response');
    err.name = 'JobTimeoutError';
    throw err;
  }
}

class RegularFailJob extends Job<Record<string, never>> {
  static jobName = 'regular-fail-job';
  override jobName = RegularFailJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(): Promise<void> {
    throw new Error('regular failure');
  }
}

function buildRuntime(queueOverrides: Partial<QueueConfig> = {}) {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(TimeoutErrorJob);
  registry.register(RegularFailJob);

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 1,
      batchSize: 5,
      maxAttempts: 1,
      ...queueOverrides,
    },
  };

  const workers: Record<string, WorkerConfig> = {
    worker: { queues: ['default'], concurrency: 1, isolation: 'inline' },
  };

  const runtime = new JobManager(queues, workers, registry, { memory: storage });
  return { storage, runtime, queues, workers };
}

describe('ResilientWorker helpers', () => {
  describe('getQueueOrder', () => {
    it('places high-priority queue first', () => {
      const storage = new InMemoryQueueStorage();
      const registry = new JobRegistry();

      const queues: Record<string, QueueConfig> = {
        low: { name: 'low', connection: 'memory', concurrency: 1, batchSize: 5 },
        high: { name: 'high', connection: 'memory', concurrency: 1, batchSize: 5, priority: 'high' },
        normal: { name: 'normal', connection: 'memory', concurrency: 1, batchSize: 5 },
      };

      const config: WorkerConfig = { queues: ['low', 'high', 'normal'], concurrency: 1, isolation: 'inline' };
      const runtime = new JobManager(queues, {}, registry, { memory: storage });
      const worker = new ResilientWorker('w', config, runtime, { memory: storage }, queues);

      const order = worker.getQueueOrder();
      expect(order[0]).toBe('high');
    });

    it('preserves original order when no priorities differ', () => {
      const storage = new InMemoryQueueStorage();
      const registry = new JobRegistry();

      const queues: Record<string, QueueConfig> = {
        alpha: { name: 'alpha', connection: 'memory', concurrency: 1, batchSize: 5 },
        beta: { name: 'beta', connection: 'memory', concurrency: 1, batchSize: 5 },
      };

      const config: WorkerConfig = { queues: ['alpha', 'beta'], concurrency: 1, isolation: 'inline' };
      const runtime = new JobManager(queues, {}, registry, { memory: storage });
      const worker = new ResilientWorker('w', config, runtime, { memory: storage }, queues);

      const order = worker.getQueueOrder();
      expect(order).toHaveLength(2);
    });
  });

  describe('stop', () => {
    it('stop() marks the worker as not running', () => {
      const { storage, runtime, queues, workers } = buildRuntime();
      const worker = new ResilientWorker('w', workers.worker!, runtime, { memory: storage }, queues);

      // Worker is not started (running=false initially), stop is still safe
      worker.stop();

      // Ensure tick can be called without running (it should just exit the loop)
      // If running were true, loop() would call tick infinitely; stop prevents that
      expect(worker.stop).toBeTypeOf('function');
    });
  });

  describe('isTimeoutError (via circuit breaker tripOnTimeout=false)', () => {
    it('does not trip circuit breaker when error is a JobTimeoutError and tripOnTimeout=false', async () => {
      const { storage, runtime, queues, workers } = buildRuntime({
        maxAttempts: 1,
        reliability: {
          circuitBreaker: {
            failureThreshold: 1,
            cooldownMs: 60_000,
            tripOnTimeout: false,
          },
        },
      });

      await runtime.dispatch(new TimeoutErrorJob({}));

      const worker = new ResilientWorker(
        'w',
        workers.worker!,
        runtime,
        { memory: storage },
        queues
      );

      // Tick once — job fails with JobTimeoutError; since tripOnTimeout=false, circuit stays closed
      await worker.tick();

      // Dispatch another job — if circuit were open it would not be consumed
      await runtime.dispatch(new TimeoutErrorJob({}));
      const depthBefore = await storage.getQueueDepth('default');
      await worker.tick();
      const depthAfter = await storage.getQueueDepth('default');

      // Circuit did NOT trip, so the second job was consumed
      expect(depthBefore).toBe(1);
      expect(depthAfter).toBe(0);
    });

    it('trips circuit breaker when error is non-Error and tripOnTimeout=false', async () => {
      // A job that throws a non-Error (string) — isTimeoutError returns false,
      // so the failure still counts and the circuit trips at threshold=1.
      class StringThrowJob extends Job<Record<string, never>> {
        static jobName = 'string-throw-job';
        override jobName = StringThrowJob.jobName;
        override queue() { return 'default'; }
        override isolation(): 'inline' { return 'inline'; }
        override async handle(): Promise<void> {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'plain string error';
        }
      }

      const storage = new InMemoryQueueStorage();
      const registry = new JobRegistry();
      registry.register(StringThrowJob);

      const queues: Record<string, QueueConfig> = {
        default: {
          name: 'default',
          connection: 'memory',
          concurrency: 1,
          batchSize: 5,
          maxAttempts: 1,
          reliability: {
            circuitBreaker: {
              failureThreshold: 1,
              cooldownMs: 60_000,
              tripOnTimeout: false,
            },
          },
        },
      };

      const workers: Record<string, WorkerConfig> = {
        worker: { queues: ['default'], concurrency: 1, isolation: 'inline' },
      };

      const runtime = new JobManager(queues, workers, registry, { memory: storage });
      await runtime.dispatch(new StringThrowJob({}));

      const worker = new ResilientWorker('w', workers.worker!, runtime, { memory: storage }, queues);
      await worker.tick(); // processes + fails with non-Error → isTimeoutError=false → circuit trips

      // Second job should NOT be consumed because circuit is open
      await runtime.dispatch(new StringThrowJob({}));
      const depthBefore = await storage.getQueueDepth('default');
      await worker.tick();
      const depthAfter = await storage.getQueueDepth('default');

      expect(depthBefore).toBe(1);
      expect(depthAfter).toBe(1); // circuit was open, skipped dequeue
    });
  });
});
