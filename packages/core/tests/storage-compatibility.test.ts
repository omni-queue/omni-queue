import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';
import { Supervisor } from '../src/libs/supervisor';

class LegacyCompatJob extends Job<{ value: string }> {
  static jobName = 'legacy-compat-job';
  override jobName = LegacyCompatJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { value: string }): Promise<string> {
    return payload.value;
  }
}

describe('legacy storage compatibility', () => {
  it('does not throw when completed-job methods are missing at runtime', async () => {
    const storage = new InMemoryQueueStorage();
    (storage as InMemoryQueueStorage & { addCompletedJob?: unknown }).addCompletedJob = undefined;
    (storage as InMemoryQueueStorage & { getCompletedJobs?: unknown }).getCompletedJobs = undefined;

    const registry = new JobRegistry();
    registry.register(LegacyCompatJob);

    const queues: Record<string, QueueConfig> = {
      default: {
        name: 'default',
        connection: 'memory',
        concurrency: 1,
        batchSize: 5,
        maxAttempts: 1,
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

    await manager.dispatch(new LegacyCompatJob({ value: 'ok' }), { jobId: 'legacy-1' });
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    await expect(manager.execute(leased[0]!)).resolves.toBe('ok');
    await expect(supervisor.getCompletedJobs({ queueName: 'default' })).resolves.toEqual([]);
  });
});
