import { afterEach, describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import type { QueueLifecycleEvent } from '../src/libs/lifecycle-events';
import { JobRegistry } from '../src/libs/registry';
import { Supervisor } from '../src/libs/supervisor';

class ReliabilityJob extends Job<{ value: string }> {
  static jobName = 'reliability-test-job';
  override jobName = ReliabilityJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(): Promise<void> {
    throw new Error('reliability test failure');
  }
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 1000,
  intervalMs = 10
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('supervisor reliability state', () => {
  afterEach(() => {
    // Ensure supervisor cleanup doesn't bleed into other tests
  });

  it('updateReliabilityState tracks circuit.changed event when circuit opens', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(ReliabilityJob);

    const queues: Record<string, QueueConfig> = {
      default: {
        name: 'default',
        connection: 'memory',
        concurrency: 1,
        batchSize: 5,
        maxAttempts: 1,
        reliability: {
          circuitBreaker: {
            failureThreshold: 1,
            cooldownMs: 60_000,
          },
        },
      },
    };

    const workers: Record<string, WorkerConfig> = {
      worker: { queues: ['default'], concurrency: 1, isolation: 'inline' },
    };

    const supervisor = new Supervisor({
      queues,
      workers,
      registry,
      storageAdapters: { memory: storage },
    });

    const events: QueueLifecycleEvent[] = [];
    const unsubscribe = supervisor.subscribeLifecycleEvents((e) => {
      events.push(e);
    });

    try {
      await supervisor.start('hybrid');

      // Dispatch a failing job — worker will process it, circuit breaker trips
      await supervisor.jobManager.dispatch(new ReliabilityJob({ value: 'fail' }));

      // Wait for circuit.changed event
      await waitFor(() => events.some((e) => e.type === 'queue.circuit.changed'));

      // getReliabilitySnapshot reflects the open circuit recorded by updateReliabilityState
      const snapshot = supervisor.getReliabilitySnapshot();
      expect(snapshot.openCircuits).toBeGreaterThanOrEqual(1);
      expect(snapshot.queues.find((q) => q.queueName === 'default')?.circuitState).toBe('open');
    } finally {
      unsubscribe();
      supervisor.stop();
    }
  });

  it('scaleTo adds workers when current count is below target', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();

    const queues: Record<string, QueueConfig> = {
      default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 5 },
    };

    const workers: Record<string, WorkerConfig> = {
      worker: { queues: ['default'], concurrency: 1, isolation: 'inline' },
    };

    const supervisor = new Supervisor({
      queues,
      workers,
      registry,
      storageAdapters: { memory: storage },
    });

    await supervisor.start('hybrid');

    // At this point 1 worker is running (concurrency = 1)
    const workersBefore = (supervisor as any).workers.get('worker') as unknown[];
    expect(workersBefore).toHaveLength(1);

    // Scale up to 2
    (supervisor as any).scaleTo('worker', workers.worker, 2);

    const workersAfter = (supervisor as any).workers.get('worker') as unknown[];
    expect(workersAfter).toHaveLength(2);

    supervisor.stop();
  });

  it('scaleTo removes workers when current count exceeds target', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();

    const queues: Record<string, QueueConfig> = {
      default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 5 },
    };

    const workers: Record<string, WorkerConfig> = {
      worker: { queues: ['default'], concurrency: 2, isolation: 'inline' },
    };

    const supervisor = new Supervisor({
      queues,
      workers,
      registry,
      storageAdapters: { memory: storage },
    });

    await supervisor.start('hybrid');

    const workersBefore = (supervisor as any).workers.get('worker') as unknown[];
    expect(workersBefore).toHaveLength(2);

    // Scale down to 1
    (supervisor as any).scaleTo('worker', workers.worker, 1);

    const workersAfter = (supervisor as any).workers.get('worker') as unknown[];
    expect(workersAfter).toHaveLength(1);

    supervisor.stop();
  });

  it('scaleTo is a no-op when worker name is not in the map', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();

    const queues: Record<string, QueueConfig> = {
      default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 5 },
    };

    const supervisor = new Supervisor({
      queues,
      workers: {},
      registry,
      storageAdapters: { memory: storage },
    });

    // workers map has no entry for 'missing' — scaleTo should return early
    expect(() =>
      (supervisor as any).scaleTo('missing', { queues: ['default'], concurrency: 1, isolation: 'inline' }, 3)
    ).not.toThrow();
  });
});
