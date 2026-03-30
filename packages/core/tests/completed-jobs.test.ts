import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';
import { Supervisor } from '../src/libs/supervisor';

class SuccessJob extends Job<{ value: string }> {
  static jobName = 'success-job';
  override jobName = SuccessJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { value: string }): Promise<{ echoed: string }> {
    return { echoed: payload.value };
  }
}

function createContext() {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(SuccessJob);

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

  return { storage, manager, supervisor };
}

describe('completed job history', () => {
  it('stores completed jobs for dashboard history after successful execution', async () => {
    const { storage, manager, supervisor } = createContext();

    await manager.dispatch(new SuccessJob({ value: 'ok' }), { jobId: 'completed-1' });
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    await expect(manager.execute(leased[0]!)).resolves.toEqual({ echoed: 'ok' });

    const completed = await supervisor.getCompletedJobs({ queueName: 'default' });
    expect(completed).toHaveLength(1);
    expect(completed[0]!.id).toBe('completed-1');
    expect(completed[0]!.state).toBe('completed');
    expect(completed[0]!.result).toEqual({ echoed: 'ok' });
  });
});