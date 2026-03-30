import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { Supervisor } from '../src/libs/supervisor';
import type { StoredJob } from '../src/types';

function buildStoredJob(overrides: Partial<StoredJob>): StoredJob {
  const now = Date.now();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'test-job',
    payload: overrides.payload ?? {},
    queue: overrides.queue ?? 'default',
    attempts: overrides.attempts ?? 0,
    state: overrides.state ?? 'queued',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...(overrides.delayUntil !== undefined ? { delayUntil: overrides.delayUntil } : {}),
  };
}

describe('Supervisor.queryDeferredJobs', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aggregates deferred jobs across queues and supports status filtering', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();

    const queues = {
      email: { name: 'email', connection: 'memory', concurrency: 1, batchSize: 10 },
      media: { name: 'media', connection: 'memory', concurrency: 1, batchSize: 10 },
    };

    const supervisor = new Supervisor(queues, {}, registry, { memory: storage });

    const now = Date.now();

    await storage.enqueue(
      buildStoredJob({ id: 'pending-email', queue: 'email', delayUntil: now + 10_000 })
    );
    await storage.enqueue(
      buildStoredJob({ id: 'promoted-media', queue: 'media', delayUntil: now - 5_000 })
    );
    await storage.enqueue(
      buildStoredJob({ id: 'failed-media', queue: 'media', delayUntil: now + 1_000 })
    );

    await storage.moveJobToQueue('media', 'failed-media', 'failed');

    const pending = await supervisor.queryDeferredJobs({ status: 'pending' });
    expect(pending.map((job) => job.id)).toEqual(['pending-email']);

    const promoted = await supervisor.queryDeferredJobs({ status: 'promoted' });
    expect(promoted.map((job) => job.id)).toEqual(['promoted-media']);

    const failed = await supervisor.queryDeferredJobs({ status: 'failed' });
    expect(failed.map((job) => job.id)).toEqual(['failed-media']);
  });

  it('supports queue scoping and global pagination', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();

    const queues = {
      queueA: { name: 'queueA', connection: 'memory', concurrency: 1, batchSize: 10 },
      queueB: { name: 'queueB', connection: 'memory', concurrency: 1, batchSize: 10 },
    };

    const supervisor = new Supervisor(queues, {}, registry, { memory: storage });

    const now = Date.now();

    await storage.enqueue(buildStoredJob({ id: 'a-1', queue: 'queueA', delayUntil: now + 2_000 }));
    await storage.enqueue(buildStoredJob({ id: 'b-1', queue: 'queueB', delayUntil: now + 1_000 }));
    await storage.enqueue(buildStoredJob({ id: 'a-2', queue: 'queueA', delayUntil: now + 3_000 }));

    const scoped = await supervisor.queryDeferredJobs({ queueName: 'queueA', status: 'pending' });
    expect(scoped.map((job) => job.id)).toEqual(['a-1', 'a-2']);

    const paged = await supervisor.queryDeferredJobs({ status: 'pending', offset: 1, limit: 1 });
    expect(paged.map((job) => job.id)).toEqual(['a-1']);
  });
});
