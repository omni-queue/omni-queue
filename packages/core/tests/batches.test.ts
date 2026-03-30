import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { Supervisor } from '../src/libs/supervisor';

class BatchSuccessJob extends Job<{ value: string }> {
  static jobName = 'batch-success-job';
  override jobName = BatchSuccessJob.jobName;

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

function createContext() {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(BatchSuccessJob);

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

  const supervisor = new Supervisor({
    queues,
    workers,
    registry,
    storageAdapters: { memory: storage },
  });

  return { supervisor, storage };
}

describe('batch tracking', () => {
  it('tracks batch jobs through completion', async () => {
    const { supervisor, storage } = createContext();

    const batchId = await supervisor.jobManager.dispatchBatch('test batch', [
      new BatchSuccessJob({ value: 'a' }),
      new BatchSuccessJob({ value: 'b' }),
    ]);

    const leased = await storage.dequeue({ queue: 'default', batchSize: 2, leaseMs: 30_000 });
    await supervisor.jobManager.execute(leased[0]!);
    await supervisor.jobManager.execute(leased[1]!);

    const batch = supervisor.getBatch(batchId);
    expect(batch).not.toBeUndefined();
    expect(batch?.name).toBe('test batch');
    expect(batch?.totalJobs).toBe(2);
    expect(batch?.completedJobs).toBe(2);
    expect(batch?.pendingJobs).toBe(0);
    expect(batch?.status).toBe('completed');
    expect(batch?.jobs.every((job) => job.state === 'completed')).toBe(true);
  });
});