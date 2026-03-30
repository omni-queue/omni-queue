import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import type { StoredJob } from '@omni-queue/core';
import { RedisStore } from '../src/redis-store';

const runIntegration =
  process.env.RUN_INTEGRATION_TESTS === 'true' &&
  typeof process.env.REDIS_TEST_URL === 'string' &&
  process.env.REDIS_TEST_URL.length > 0;

const integration = runIntegration ? describe : describe.skip;

function createJob(overrides: Partial<StoredJob> = {}): StoredJob {
  const now = Date.now();
  return {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? 'integration-job',
    payload: overrides.payload ?? { ok: true },
    queue: overrides.queue ?? 'integration-queue',
    attempts: overrides.attempts ?? 0,
    state: overrides.state ?? 'queued',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...(overrides.delayUntil !== undefined ? { delayUntil: overrides.delayUntil } : {}),
  };
}

integration('RedisStore integration', () => {
  it('handles delayed enqueue, promotion, and dequeue with a live Redis instance', async () => {
    const prefix = `omniq:test:${randomUUID()}`;
    const client = new Redis(process.env.REDIS_TEST_URL!);
    const store = new RedisStore({ client, prefix });

    const now = Date.now();
    const delayed = createJob({ id: `delayed-${randomUUID()}`, delayUntil: now + 5_000 });
    const ready = createJob({ id: `ready-${randomUUID()}` });

    await store.enqueue(delayed);
    await store.enqueue(ready);

    expect(await store.getQueueDepth(delayed.queue)).toBe(2);

    const firstBatch = await store.dequeue({ queue: delayed.queue, batchSize: 10, leaseMs: 10_000 });
    expect(firstBatch.map((job) => job.id)).toEqual([ready.id]);

    const dueBefore = await store.getDelayedJobs(delayed.queue, now + 1_000);
    expect(dueBefore).toHaveLength(0);

    const dueAfter = await store.getDelayedJobs(delayed.queue, now + 10_000);
    expect(dueAfter.map((job) => job.id)).toEqual([delayed.id]);

    await store.moveJobToQueue(delayed.queue, delayed.id, 'active');
    const secondBatch = await store.dequeue({ queue: delayed.queue, batchSize: 10, leaseMs: 10_000 });
    expect(secondBatch.map((job) => job.id)).toEqual([delayed.id]);

    await store.close();
  });
});
