import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';
import { Supervisor } from '../src/libs/supervisor';

class ArchiveQueryJob extends Job<{ message: string }> {
  static jobName = 'archive-query-job';
  override jobName = ArchiveQueryJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { message: string }): Promise<{ echoed: string }> {
    return { echoed: payload.message };
  }
}

describe('archive querying', () => {
  it('filters historical completed jobs by name and search text', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(ArchiveQueryJob);

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

    await manager.dispatch(new ArchiveQueryJob({ message: 'alpha-record' }), { jobId: 'archive-1' });
    await manager.dispatch(new ArchiveQueryJob({ message: 'beta-record' }), { jobId: 'archive-2' });

    const leased = await storage.dequeue({ queue: 'default', batchSize: 2, leaseMs: 30_000 });
    await manager.execute(leased[0]!);
    await manager.execute(leased[1]!);

    const byJobName = await supervisor.queryJobArchive({ jobName: ArchiveQueryJob.jobName });
    expect(byJobName).toHaveLength(2);

    const bySearch = await supervisor.queryJobArchive({ search: 'beta-record' });
    expect(bySearch).toHaveLength(1);
    expect(bySearch[0]!.id).toBe('archive-2');
  });
});
