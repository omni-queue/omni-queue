import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { ScheduledJobPromoter } from '../src/libs/scheduled-job-promoter';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { StoredJob } from '../src/types';

function makeQueues(): Record<string, QueueConfig> {
  return {
    default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 5 },
  };
}

function makeStoredJob(overrides: Partial<StoredJob> = {}): StoredJob {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: 'test-job',
    payload: {},
    queue: 'default',
    state: 'queued',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ScheduledJobPromoter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('start() is idempotent — second call returns early (line 48)', () => {
    const storage = new InMemoryQueueStorage();
    // Use a very long polling interval so the interval never fires during the test
    const promoter = new ScheduledJobPromoter(storage, makeQueues(), 100_000);

    promoter.start();
    const intervalAfterFirst = (promoter as any).interval;

    // Second start() hits the `if (this.running) return` guard
    promoter.start();
    const intervalAfterSecond = (promoter as any).interval;

    // Same interval handle — no new setInterval was created
    expect(intervalAfterSecond).toBe(intervalAfterFirst);

    promoter.stop();
  });

  it('promote() catches and logs errors from storage (lines 79-83)', async () => {
    const storage = new InMemoryQueueStorage();
    vi.spyOn(storage, 'getDelayedJobs').mockRejectedValue(new Error('storage blew up'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const promoter = new ScheduledJobPromoter(storage, makeQueues(), 100_000);

    // Call private promote() directly
    await (promoter as any).promote();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[promoter]'),
      expect.any(Error)
    );
  });

  it('promote() calls onJobPromoted plugin hook for each promoted job', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));

    const storage = new InMemoryQueueStorage();

    // Enqueue a job that is already past its delayUntil
    await storage.enqueue(
      makeStoredJob({ id: 'j-past-due', delayUntil: Date.now() - 5_000 })
    );

    const onJobPromoted = vi.fn().mockResolvedValue(undefined);
    const plugin = { onJobPromoted };

    const promoter = new ScheduledJobPromoter(storage, makeQueues(), 100_000, [plugin]);

    await (promoter as any).promote();

    expect(onJobPromoted).toHaveBeenCalledOnce();
    expect(onJobPromoted).toHaveBeenCalledWith(expect.objectContaining({ id: 'j-past-due' }));
  });

  it('promote() logs a per-job error when individual job promotion fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));

    const storage = new InMemoryQueueStorage();
    await storage.enqueue(makeStoredJob({ id: 'j-fail', delayUntil: Date.now() - 1_000 }));

    // Make moveJobToQueue throw for the individual job
    vi.spyOn(storage, 'moveJobToQueue').mockRejectedValue(new Error('move failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const promoter = new ScheduledJobPromoter(storage, makeQueues(), 100_000);
    await (promoter as any).promote();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[promoter] Error promoting job'),
      expect.any(Error)
    );
  });
});
