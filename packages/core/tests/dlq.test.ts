import { describe, expect, it, vi } from 'vitest';
import { Job } from '../src/contracts/job';
import type { Plugin } from '../src/interfaces/plugin';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';
import { Supervisor } from '../src/libs/supervisor';

class AlwaysFailJob extends Job<{ id: string }> {
  static jobName = 'always-fail-job';
  override jobName = AlwaysFailJob.jobName;

  override queue(): string {
    return 'default';
  }

  override retries(): number {
    return 5;
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(): Promise<void> {
    throw new Error('boom');
  }
}

function createContext(plugin?: Plugin) {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(AlwaysFailJob);

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 1,
      batchSize: 5,
      maxAttempts: 1,
      ...(plugin ? { plugins: [plugin] } : {}),
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
  const supervisor = new Supervisor({
    queues,
    workers,
    registry,
    storageAdapters,
  });

  return { storage, manager, supervisor };
}

describe('Phase 1.4 DLQ', () => {
  it('moves job to DLQ and emits onFailedPermanently when maxAttempts reached', async () => {
    const onFailedPermanently = vi.fn(async () => undefined);
    const { storage, manager } = createContext({ onFailedPermanently });

    await manager.dispatch(new AlwaysFailJob({ id: 'a' }), { jobId: 'dlq-1' });
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
    expect(leased).toHaveLength(1);

    await expect(manager.execute(leased[0]!)).rejects.toThrow('boom');

    const dlq = await storage.getDeadLetterJobs({ queueName: 'default' });
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.id).toBe('dlq-1');
    expect(dlq[0]!.errorDetails?.error).toBe('boom');
    expect(dlq[0]!.errorDetails?.errorName).toBe('Error');
    expect(onFailedPermanently).toHaveBeenCalledOnce();
  });

  it('supervisor exposes getDLQ and retryDLQ', async () => {
    const { storage, manager, supervisor } = createContext();

    await manager.dispatch(new AlwaysFailJob({ id: 'b' }), { jobId: 'dlq-2' });
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
    await expect(manager.execute(leased[0]!)).rejects.toThrow('boom');

    const beforeRetry = await supervisor.getDLQ({ queueName: 'default' });
    expect(beforeRetry.map((job) => job.id)).toContain('dlq-2');

    const retried = await supervisor.retryDLQ('default', 'dlq-2');
    expect(retried).toBe(true);

    const afterRetry = await supervisor.getDLQ({ queueName: 'default' });
    const original = afterRetry.find((job) => job.id === 'dlq-2');
    expect(original).toBeDefined();
    expect(original?.retriedAt).toBeTypeOf('number');
    expect(original?.retriedJobId).toBeTypeOf('string');

    const retryAgain = await supervisor.retryDLQ('default', 'dlq-2');
    expect(retryAgain).toBe(false);

    const requeued = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
    expect(requeued).toHaveLength(1);
    expect(requeued[0]!.id).toBe(original?.retriedJobId);
    expect(requeued[0]!.state).toBe('leased');
    expect(requeued[0]!.attempts).toBe(0);
    expect(requeued[0]!.errorDetails).toBeUndefined();
  });
});
