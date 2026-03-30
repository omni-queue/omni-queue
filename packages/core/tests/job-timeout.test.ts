import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';
import { Supervisor } from '../src/libs/supervisor';

class SlowTimeoutJob extends Job<{ waitMs: number }> {
  static jobName = 'slow-timeout-job';
  override jobName = SlowTimeoutJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { waitMs: number }): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, payload.waitMs));
    return 'done';
  }
}

describe('job timeout behavior', () => {
  it('moves timed-out jobs to dead-letter immediately when timeoutStrategy is fail', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(SlowTimeoutJob);

    const queues: Record<string, QueueConfig> = {
      default: {
        name: 'default',
        connection: 'memory',
        concurrency: 1,
        batchSize: 5,
        maxAttempts: 5,
        executionTimeoutMs: 20,
        timeoutStrategy: 'fail',
      },
    };

    const workers: Record<string, WorkerConfig> = {
      worker: {
        queues: ['default'],
        concurrency: 1,
        isolation: 'inline',
      },
    };

    const storageAdapters = { memory: storage };
    const manager = new JobManager(queues, workers, registry, storageAdapters);
    const supervisor = new Supervisor({ queues, workers, registry, storageAdapters });

    await manager.dispatch(new SlowTimeoutJob({ waitMs: 60 }), { jobId: 'timeout-1' });
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    await expect(manager.execute(leased[0]!)).rejects.toThrow(/timeout/i);

    const dlq = await supervisor.getDLQ({ queueName: 'default' });
    expect(dlq.some((job) => job.id === 'timeout-1')).toBe(true);
  });
});
