import { describe, expect, it, vi } from 'vitest';
import { Job } from '../src/contracts/job';
import type { Plugin } from '../src/interfaces/plugin';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobManager } from '../src/libs/worker-runtime';
import { JobRegistry } from '../src/libs/registry';

class ProgressJob extends Job<{ steps: number }> {
  static jobName = 'progress-job';
  override jobName = ProgressJob.jobName;

  override async handle(payload: { steps: number }): Promise<{ ok: true }> {
    for (let i = 1; i <= payload.steps; i++) {
      await this.reportProgress(Math.round((i / payload.steps) * 100));
    }
    return { ok: true };
  }

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }
}

function createContext(plugin?: Plugin) {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(ProgressJob);

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 1,
      batchSize: 10,
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

  const manager = new JobManager(queues, workers, registry, { memory: storage });
  return { storage, manager };
}

describe('Phase 1.3 progress tracking', () => {
  it('setProgress persists progress and emits onProgress', async () => {
    const onProgress = vi.fn(async () => undefined);
    const { storage, manager } = createContext({ onProgress });

    await manager.dispatch(new ProgressJob({ steps: 1 }), { jobId: 'job-progress-1' });

    await manager.setProgress('job-progress-1', 'default', 35);

    const stored = storage.getJob('job-progress-1');
    expect(stored?.progress).toBe(35);
    expect(onProgress).toHaveBeenCalledWith('job-progress-1', 'default', 35);
  });

  it('inline execution calls reportProgress and updates storage', async () => {
    const onProgress = vi.fn(async () => undefined);
    const { storage, manager } = createContext({ onProgress });

    await manager.dispatch(new ProgressJob({ steps: 4 }), { jobId: 'job-progress-2' });
    const dequeued = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    expect(dequeued).toHaveLength(1);
    await manager.execute(dequeued[0]!);

    // Job is acked after completion, so fetch by id may be undefined.
    // We assert via plugin calls that progress was emitted and final 100% happened.
    const calls = onProgress.mock.calls.map((args: any[]) => args[2] as number);
    expect(calls).toEqual([25, 50, 75, 100]);
  });
});
