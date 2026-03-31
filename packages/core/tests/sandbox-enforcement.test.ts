import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';

class InlineSandboxJob extends Job<{ value: string }> {
  static jobName = 'inline-sandbox-job';
  override jobName = InlineSandboxJob.jobName;

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

describe('sandbox runtime enforcement', () => {
  it('rejects inline execution when sandbox policy is enabled', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(InlineSandboxJob);

    const queues: Record<string, QueueConfig> = {
      default: {
        name: 'default',
        connection: 'memory',
        concurrency: 1,
        batchSize: 1,
        maxAttempts: 1,
        sandbox: {
          enabled: true,
          denyNetwork: true,
        },
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

    await manager.dispatch(new InlineSandboxJob({ value: 'x' }), { jobId: 'sandbox-inline-1' });
    const leased = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });

    await expect(manager.execute(leased[0]!)).rejects.toThrow(
      "Sandbox policy requires non-inline isolation for queue 'default'. Use 'thread' or 'process'."
    );
  });
});
