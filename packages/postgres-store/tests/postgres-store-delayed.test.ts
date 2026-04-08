import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredJob } from '@vasto-queue/core';

type JobRow = {
  id: string;
  name: string;
  payload: unknown;
  queue: string;
  state: StoredJob['state'];
  attempts: number;
  max_attempts: number | null;
  idempotency_key: string | null;
  delay_until: number | null;
  priority: string | null;
  scheduled_cron: string | null;
  last_scheduled_at: number | null;
  lease_until: Date | null;
  created_at: number;
  updated_at: number;
};

vi.mock('pg', async () => {
  class MockPool {
    private rows = new Map<string, JobRow>();

    async query(textOrConfig: string | { text: string; values?: unknown[] }, params: unknown[] = []): Promise<{ rows: JobRow[] }> {
      let sql: string;
      let values: unknown[];

      if (typeof textOrConfig === 'string') {
        sql = textOrConfig;
        values = params;
      } else {
        sql = textOrConfig.text;
        values = textOrConfig.values ?? [];
      }

      sql = sql.replace(/\s+/g, ' ').trim();

      // Handle CTE-based dequeue with candidates and updated
      if (sql.startsWith('WITH candidates AS')) {
        // Extract parameters: $1=queue, $2=batchSize, $3=leaseUntil, $4=nowMs
        const [queue, batchSize, leaseUntil] = values as [string, number, Date, number];
        const now = Date.now();

        const selected = [...this.rows.values()]
          .filter((row) => {
            if (queue && row.queue !== queue) return false;

            const queuedAndReady = row.state === 'queued' && row.delay_until == null;
            const leasedExpired =
              row.state === 'leased' && row.lease_until != null && row.lease_until.getTime() < now;

            return queuedAndReady || leasedExpired;
          })
          .sort((a, b) => {
            // Sort by bucket (queued=0, leased=1), then by priority, then by created_at
            const aBucket = a.state === 'queued' ? 0 : 1;
            const bBucket = b.state === 'queued' ? 0 : 1;
            if (aBucket !== bBucket) return aBucket - bBucket;

            const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
            const aPrio = priorityOrder[(a.priority ?? 'normal') as keyof typeof priorityOrder] ?? 2;
            const bPrio = priorityOrder[(b.priority ?? 'normal') as keyof typeof priorityOrder] ?? 2;
            if (aPrio !== bPrio) return aPrio - bPrio;

            return a.created_at - b.created_at;
          })
          .slice(0, batchSize);

        for (const row of selected) {
          row.state = 'leased';
          row.lease_until = leaseUntil;
          row.updated_at = now;
        }

        return { rows: selected };
      }

      if (sql.includes('INSERT INTO') && sql.includes('(id, name, payload, queue, created_at, updated_at)')) {
        // Minimal INSERT path
        const [id, name, payload, queue, createdAt, updatedAt] = values as [
          string,
          string,
          string,
          string,
          number,
          number,
        ];

        const row: JobRow = {
          id,
          name,
          payload: typeof payload === 'string' ? JSON.parse(payload) : payload,
          queue,
          state: 'queued',
          attempts: 0,
          max_attempts: null,
          idempotency_key: null,
          priority: 'normal',
          delay_until: null,
          scheduled_cron: null,
          last_scheduled_at: null,
          lease_until: null,
          created_at: createdAt,
          updated_at: updatedAt,
        };

        this.rows.set(id, row);
        return { rows: [] };
      }

      if (sql.includes('INSERT INTO') && sql.includes('(id, name, payload, queue') && sql.includes('state')) {
        // Full INSERT path
        const [
          id,
          name,
          payload,
          queue,
          state,
          attempts,
          maxAttempts,
          idempotencyKey,
          delayUntil,
          scheduledCron,
          lastScheduledAt,
          createdAt,
          updatedAt,
        ] = values as [
          string,
          string,
          string,
          string,
          StoredJob['state'],
          number,
          number | null,
          string | null,
          number | null,
          string | null,
          number | null,
          number,
          number,
        ];

        const row: JobRow = {
          id,
          name,
          payload: typeof payload === 'string' ? JSON.parse(payload) : payload,
          queue,
          state,
          attempts,
          max_attempts: maxAttempts,
          idempotency_key: idempotencyKey,
          delay_until: delayUntil,
          scheduled_cron: scheduledCron,
          last_scheduled_at: lastScheduledAt,
          lease_until: null,
          priority: 'normal',
          created_at: createdAt,
          updated_at: updatedAt,
        };

        this.rows.set(id, row);
        return { rows: [] };
      }

      if (sql.startsWith('SELECT *') && sql.includes("state = 'queued'") && sql.includes('delay_until <= $2')) {
        const [queueName, beforeDate] = values as [string, number];

        const rows = [...this.rows.values()]
          .filter(
            (row) =>
              row.queue === queueName &&
              row.state === 'queued' &&
              row.delay_until != null &&
              row.delay_until <= beforeDate
          )
          .sort((a, b) => {
            const delayDiff = (a.delay_until ?? 0) - (b.delay_until ?? 0);
            if (delayDiff !== 0) return delayDiff;
            return a.created_at - b.created_at;
          });

        return { rows };
      }

      if (sql.startsWith('UPDATE') && sql.includes('SET state = \'queued\', delay_until = NULL')) {
        const [jobId, queueName] = values as [string, string];
        const row = this.rows.get(jobId);
        if (row && row.queue === queueName) {
          row.state = 'queued';
          row.delay_until = null;
          row.updated_at = Date.now();
        }
        return { rows: [] };
      }

      if (sql.startsWith('UPDATE') && sql.includes("SET state = 'failed'")) {
        const [jobId, queueName] = values as [string, string];
        const row = this.rows.get(jobId);
        if (row && row.queue === queueName) {
          row.state = 'failed';
          row.updated_at = Date.now();
        }
        return { rows: [] };
      }

      if (sql.startsWith('UPDATE') && sql.includes("SET state = 'leased'") && sql.includes('RETURNING *')) {
        const [batchSize, leaseUntil, queue] = values as [number, Date, string?];
        const now = Date.now();

        const selected = [...this.rows.values()]
          .filter((row) => {
            if (queue && row.queue !== queue) return false;

            const queuedAndReady = row.state === 'queued' && row.delay_until == null;
            const leasedExpired =
              row.state === 'leased' && row.lease_until != null && row.lease_until.getTime() < now;

            return queuedAndReady || leasedExpired;
          })
          .sort((a, b) => a.created_at - b.created_at)
          .slice(0, batchSize);

        for (const row of selected) {
          row.state = 'leased';
          row.lease_until = leaseUntil;
          row.updated_at = now;
        }

        return { rows: selected };
      }

      if (sql.startsWith('SELECT *') && sql.includes('WHERE delay_until IS NOT NULL')) {
        const limit = Number(values[values.length - 2] ?? 100);
        const offset = Number(values[values.length - 1] ?? 0);
        const coreParams = values.slice(0, -2);

        let cursor = 0;
        let queueName: string | undefined;
        if (sql.includes('queue = $') && typeof coreParams[cursor] === 'string') {
          queueName = coreParams[cursor] as string;
          cursor += 1;
        }

        let threshold: number | undefined;
        if ((sql.includes('delay_until > $') || sql.includes('delay_until <= $')) && typeof coreParams[cursor] === 'number') {
          threshold = coreParams[cursor] as number;
        }

        const rows = [...this.rows.values()]
          .filter((row) => {
            if (row.delay_until == null) return false;
            if (queueName && row.queue !== queueName) return false;

            if (sql.includes("state = 'failed'")) {
              return row.state === 'failed';
            }

            if (sql.includes('delay_until > $')) {
              return row.state === 'queued' && row.delay_until > (threshold ?? Number.MAX_SAFE_INTEGER);
            }

            if (sql.includes('delay_until <= $')) {
              return row.state === 'queued' && row.delay_until <= (threshold ?? 0);
            }

            return true;
          })
          .sort((a, b) => {
            const delayDiff = (a.delay_until ?? 0) - (b.delay_until ?? 0);
            if (delayDiff !== 0) return delayDiff;
            return a.created_at - b.created_at;
          })
          .slice(offset, offset + limit);

        return { rows };
      }

      if (sql.includes('SELECT COUNT(*) AS count')) {
        const [queue] = values as [string];
        const count = [...this.rows.values()].filter(
          (row) => row.queue === queue && (row.state === 'queued' || row.state === 'leased')
        ).length;

        return { rows: [{ count: String(count) } as unknown as JobRow] };
      }

      if (sql.startsWith('DELETE FROM')) {
        const [jobId] = values as [string];
        this.rows.delete(jobId);
        return { rows: [] };
      }

      return { rows: [] };
    }

    async end(): Promise<void> {}
  }

  return {
    __esModule: true,
    Pool: MockPool,
  };
});

import { PostgresStore } from '../src/postgres-store';

function job(overrides: Partial<StoredJob> = {}): StoredJob {
  const now = 1_711_715_200_000;
  return {
    id: overrides.id ?? 'job-1',
    name: overrides.name ?? 'test',
    payload: overrides.payload ?? { ok: true },
    queue: overrides.queue ?? 'emails',
    attempts: overrides.attempts ?? 0,
    state: overrides.state ?? 'queued',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

describe('PostgresStore delayed/deferred behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('excludes delayed jobs from normal dequeue until promoted', async () => {
    const store = new PostgresStore({ pool: {} as never });

    await store.enqueue(job({ id: 'ready-1' }));
    await store.enqueue(job({ id: 'delay-1', delayUntil: Date.now() + 10_000 }));

    const dequeued = await store.dequeue({ queue: 'emails', batchSize: 10, leaseMs: 1000 });
    expect(dequeued.map((item) => item.id)).toEqual(['ready-1']);

    await store.moveJobToQueue('emails', 'delay-1', 'active');
    const dequeuedAfterPromotion = await store.dequeue({ queue: 'emails', batchSize: 10, leaseMs: 1000 });
    expect(dequeuedAfterPromotion.map((item) => item.id)).toEqual(['delay-1']);

    await store.close();
  });

  it('returns due delayed jobs for promotion and supports pending/promoted filters', async () => {
    const store = new PostgresStore({ pool: {} as never });
    const now = Date.now();

    await store.enqueue(job({ id: 'delay-past', delayUntil: now - 100 }));
    await store.enqueue(job({ id: 'delay-future', delayUntil: now + 10_000 }));

    const due = await store.getDelayedJobs('emails', now);
    expect(due.map((item) => item.id)).toEqual(['delay-past']);

    const pending = await store.queryDeferredJobs({ queueName: 'emails', status: 'pending' });
    expect(pending.map((item) => item.id)).toEqual(['delay-future']);

    const promoted = await store.queryDeferredJobs({ queueName: 'emails', status: 'promoted' });
    expect(promoted.map((item) => item.id)).toEqual(['delay-past']);

    await store.close();
  });

  it('keeps failed deferred jobs queryable via failed status', async () => {
    const store = new PostgresStore({ pool: {} as never });

    await store.enqueue(job({ id: 'delay-failed', delayUntil: Date.now() + 5000 }));
    await store.moveJobToQueue('emails', 'delay-failed', 'failed');

    const failed = await store.queryDeferredJobs({ queueName: 'emails', status: 'failed' });
    expect(failed).toHaveLength(1);
    expect(failed[0]?.id).toBe('delay-failed');
    expect(failed[0]?.state).toBe('failed');

    const due = await store.getDelayedJobs('emails', Date.now() + 100_000);
    expect(due).toHaveLength(0);

    await store.close();
  });
});
