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

describe('Supervisor admin operations', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('promotes a deferred job into ready queue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00.000Z'));

    const storage = new InMemoryQueueStorage();
    const supervisor = new Supervisor(
      {
        default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 10 },
      },
      {},
      new JobRegistry(),
      { memory: storage }
    );

    await storage.enqueue(
      buildStoredJob({ id: 'deferred-1', queue: 'default', delayUntil: Date.now() + 60_000 })
    );

    const promoted = await supervisor.promoteJob('default', 'deferred-1');
    expect(promoted).toBe(true);

    const deferred = await supervisor.queryDeferredJobs({ queueName: 'default' });
    expect(deferred.find((job) => job.id === 'deferred-1')).toBeUndefined();

    const ready = await supervisor.getReadyJobs({ queueName: 'default' });
    expect(ready.map((job) => job.id)).toContain('deferred-1');
  });

  it('removes queued and dead-letter jobs by id', async () => {
    const storage = new InMemoryQueueStorage();
    const supervisor = new Supervisor(
      {
        default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 10 },
      },
      {},
      new JobRegistry(),
      { memory: storage }
    );

    const queued = buildStoredJob({ id: 'queued-1', queue: 'default' });
    const failed = buildStoredJob({ id: 'dlq-1', queue: 'default', state: 'failed' });

    await storage.enqueue(queued);
    await storage.moveToDeadLetter(failed);

    const removedQueued = await supervisor.removeJob('default', 'queued-1');
    const removedDlq = await supervisor.removeJob('default', 'dlq-1');

    expect(removedQueued).toBe(true);
    expect(removedDlq).toBe(true);

    const ready = await supervisor.getReadyJobs({ queueName: 'default' });
    const dlq = await supervisor.getDLQ({ queueName: 'default' });
    expect(ready.map((job) => job.id)).not.toContain('queued-1');
    expect(dlq.map((job) => job.id)).not.toContain('dlq-1');
  });

  it('cleans queue jobs by status and obliterates remaining queue data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00.000Z'));

    const storage = new InMemoryQueueStorage();
    const supervisor = new Supervisor(
      {
        default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 10 },
      },
      {},
      new JobRegistry(),
      { memory: storage }
    );

    const now = Date.now();
    await storage.enqueue(buildStoredJob({ id: 'ready-old', queue: 'default', createdAt: now - 10_000, updatedAt: now - 10_000 }));
    await storage.enqueue(buildStoredJob({ id: 'deferred-old', queue: 'default', delayUntil: now + 10_000, createdAt: now - 10_000, updatedAt: now - 10_000 }));
    await storage.moveToDeadLetter(
      buildStoredJob({ id: 'dlq-old', queue: 'default', state: 'failed', createdAt: now - 10_000, updatedAt: now - 10_000 })
    );

    const cleanedReady = await supervisor.cleanJobs('default', { status: 'ready', graceMs: 0, limit: 10 });
    expect(cleanedReady).toBe(1);

    const obliterated = await supervisor.obliterateQueue('default');
    expect(obliterated).toBeGreaterThanOrEqual(2);

    const [readyAfter, deferredAfter, dlqAfter] = await Promise.all([
      supervisor.getReadyJobs({ queueName: 'default' }),
      supervisor.queryDeferredJobs({ queueName: 'default' }),
      supervisor.getDLQ({ queueName: 'default' }),
    ]);

    expect(readyAfter).toHaveLength(0);
    expect(deferredAfter).toHaveLength(0);
    expect(dlqAfter).toHaveLength(0);
  });
});
