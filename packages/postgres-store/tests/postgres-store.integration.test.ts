import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { StoredJob } from '@vasto-queue/core';
import { PostgresStore } from '../src/postgres-store';

const runIntegration =
  process.env.RUN_INTEGRATION_TESTS === 'true' &&
  typeof process.env.PG_TEST_URL === 'string' &&
  process.env.PG_TEST_URL.length > 0;

const integration = runIntegration ? describe : describe.skip;

function createJob(overrides: Partial<StoredJob> = {}): StoredJob {
  const now = Date.now();
  return {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? 'integration-job',
    payload: overrides.payload ?? { ok: true },
    queue: overrides.queue ?? 'integration',
    attempts: overrides.attempts ?? 0,
    state: overrides.state ?? 'queued',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...(overrides.delayUntil !== undefined ? { delayUntil: overrides.delayUntil } : {}),
  };
}

integration('PostgresStore integration', () => {
  it('applies delayed gating and promotion with a live Postgres instance', async () => {
    const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });

    const tableName = `vasto_jobs_${randomUUID().replace(/-/g, '_')}`;
    const deadLetterTableName = `vasto_dead_${randomUUID().replace(/-/g, '_')}`;

    const store = new PostgresStore({
      pool,
      tableName,
      deadLetterTableName,
    });

    await store.migrate();

    const now = Date.now();
    const delayed = createJob({ id: `delayed-${randomUUID()}`, delayUntil: now + 10_000 });
    const ready = createJob({ id: `ready-${randomUUID()}` });

    await store.enqueue(delayed);
    await store.enqueue(ready);

    const firstBatch = await store.dequeue({ queue: delayed.queue, batchSize: 10, leaseMs: 10_000 });
    expect(firstBatch.map((job) => job.id)).toEqual([ready.id]);

    const dueBefore = await store.getDelayedJobs(delayed.queue, now + 1_000);
    expect(dueBefore).toHaveLength(0);

    const dueAfter = await store.getDelayedJobs(delayed.queue, now + 20_000);
    expect(dueAfter.map((job) => job.id)).toEqual([delayed.id]);

    await store.moveJobToQueue(delayed.queue, delayed.id, 'active');

    const secondBatch = await store.dequeue({ queue: delayed.queue, batchSize: 10, leaseMs: 10_000 });
    expect(secondBatch.map((job) => job.id)).toEqual([delayed.id]);

    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    await pool.query(`DROP TABLE IF EXISTS ${deadLetterTableName}`);

    await store.close();
  });
});
