import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';
import { Supervisor } from '../src/libs/supervisor';

class DrainJob extends Job<{ value: string }> {
  static jobName = 'drain-job';
  override jobName = DrainJob.jobName;

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

describe('queue pause/resume/drain', () => {
  it('pauses queues and drains active jobs with timeout behavior', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(DrainJob);

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

    await manager.dispatch(new DrainJob({ value: 'test' }), { jobId: 'drain-1' });
    await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    expect(supervisor.pauseQueue('default')).toBe(true);
    expect(supervisor.isQueuePaused('default')).toBe(true);

    const timedOut = await supervisor.drainQueue('default', { timeoutMs: 50, pollIntervalMs: 10, pauseFirst: false });
    expect(timedOut).toBe(false);

    await storage.ack('drain-1');

    const drained = await supervisor.drainQueue('default', { timeoutMs: 200, pollIntervalMs: 10, pauseFirst: false });
    expect(drained).toBe(true);

    expect(supervisor.resumeQueue('default')).toBe(true);
    expect(supervisor.isQueuePaused('default')).toBe(false);
  });
});
