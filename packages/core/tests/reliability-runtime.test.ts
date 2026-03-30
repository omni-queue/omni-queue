import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { ResilientWorker } from '../src/libs/resilient-worker';
import { JobManager } from '../src/libs/worker-runtime';

class FailingJob extends Job<{ value: string }> {
  static jobName = 'failing-job';
  override jobName = FailingJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(): Promise<void> {
    throw new Error('boom');
  }
}

function createRuntime(
  queueOverrides: Partial<QueueConfig> = {},
  workerOverrides: Partial<WorkerConfig> = {}
) {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(FailingJob);

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 1,
      batchSize: 10,
      maxAttempts: 1,
      ...queueOverrides,
    },
  };

  const workers: Record<string, WorkerConfig> = {
    worker: {
      queues: ['default'],
      concurrency: 1,
      isolation: 'inline',
      ...workerOverrides,
    },
  };

  const runtime = new JobManager(queues, workers, registry, { memory: storage });
  return { storage, runtime, queues, workers };
}

describe('reliability runtime enforcement', () => {
  it('opens circuit breaker after failures and skips subsequent dequeues during cooldown', async () => {
    const { storage, runtime, queues, workers } = createRuntime({
      reliability: {
        circuitBreaker: {
          failureThreshold: 1,
          cooldownMs: 60_000,
        },
      },
    });

    await runtime.dispatch(new FailingJob({ value: 'first' }));

    const worker = new ResilientWorker('worker', workers.worker!, runtime, { memory: storage }, queues);
    await worker.tick();

    await runtime.dispatch(new FailingJob({ value: 'second' }));
    const depthBefore = await storage.getQueueDepth('default');
    await worker.tick();
    const depthAfter = await storage.getQueueDepth('default');

    expect(depthBefore).toBe(1);
    expect(depthAfter).toBe(1);
  });

  it('auto-snoozes poison messages instead of dead-lettering when policy is enabled', async () => {
    const { storage, runtime } = createRuntime({
      reliability: {
        poisonPolicy: {
          template: 'auto-snooze',
          maxFailures: 1,
          snoozeMs: 30_000,
        },
      },
    });

    await runtime.dispatch(new FailingJob({ value: 'will-snooze' }));
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    await expect(runtime.execute(leased[0]!)).rejects.toThrow('boom');

    const deferred = await storage.queryDeferredJobs({ queueName: 'default', status: 'pending', limit: 10, offset: 0 });
    const dlq = await storage.getDeadLetterJobs({ queueName: 'default', limit: 10, offset: 0 });

    expect(deferred).toHaveLength(1);
    expect(deferred[0]?.delayUntil).toBeGreaterThan(Date.now());
    expect(deferred[0]?.tags).toContain('poison:auto-snooze');
    expect(dlq).toHaveLength(0);
  });
});
