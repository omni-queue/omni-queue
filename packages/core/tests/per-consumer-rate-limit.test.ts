import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { ResilientWorker } from '../src/libs/resilient-worker';
import { JobManager } from '../src/libs/worker-runtime';

class SuccessJob extends Job<{ value: string }> {
  static jobName = 'success-job';
  override jobName = SuccessJob.jobName;

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

function createRuntime(workerEntries: Record<string, Partial<WorkerConfig>>) {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(SuccessJob);

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 1,
      batchSize: 10,
      maxAttempts: 1,
      rateLimit: {
        capacity: 10,
        refillRate: 10,
        perConsumer: {
          capacity: 1,
          refillRate: 0,
        },
      },
    },
  };

  const workers: Record<string, WorkerConfig> = Object.fromEntries(
    Object.entries(workerEntries).map(([name, overrides]) => [
      name,
      {
        queues: ['default'],
        concurrency: 1,
        isolation: 'inline',
        ...overrides,
      },
    ])
  );

  const runtime = new JobManager(queues, workers, registry, { memory: storage });
  return { storage, runtime, queues, workers };
}

describe('per-consumer rate limiting', () => {
  it('prevents one consumer from draining the queue while allowing another consumer to continue', async () => {
    const { storage, runtime, queues, workers } = createRuntime({
      alphaWorker: { consumerId: 'alpha' },
      betaWorker: { consumerId: 'beta' },
    });

    await runtime.dispatch(new SuccessJob({ value: 'first' }), { jobId: 'job-1' });
    await runtime.dispatch(new SuccessJob({ value: 'second' }), { jobId: 'job-2' });

    const alpha = new ResilientWorker('alphaWorker', workers.alphaWorker!, runtime, { memory: storage }, queues);
    const beta = new ResilientWorker('betaWorker', workers.betaWorker!, runtime, { memory: storage }, queues);

    await alpha.tick();
    let completed = await storage.getCompletedJobs({ queueName: 'default', limit: 10, offset: 0 });
    expect(completed).toHaveLength(1);

    const depthBeforeSecondAlphaTick = await storage.getQueueDepth('default');
    await alpha.tick();
    const depthAfterSecondAlphaTick = await storage.getQueueDepth('default');

    expect(depthBeforeSecondAlphaTick).toBe(1);
    expect(depthAfterSecondAlphaTick).toBe(1);

    await beta.tick();
    completed = await storage.getCompletedJobs({ queueName: 'default', limit: 10, offset: 0 });
    expect(completed).toHaveLength(2);
    expect(completed.map((job) => job.id).sort()).toEqual(['job-1', 'job-2']);
  });
});
