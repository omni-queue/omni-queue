import { Pool, PoolConfig } from 'pg';
import { createHash } from 'node:crypto';
import type {
  ActiveJobsQuery,
  ArchiveRetentionPolicy,
  CompletedJobRecord,
  CompletedJobsQuery,
  JobArchiveQuery,
  LeaseOptions,
  QueueAdminJobStatus,
  QueueCleanOptions,
  QueueStorage,
  ReadyJobsQuery,
  StoredJob,
} from '@vasto/core';

export interface PostgresStoreConfig {
  /**
   * A pre-configured `pg` Pool instance, or PoolConfig to create one.
   */
  pool: Pool | PoolConfig;

  /**
   * Table name for the jobs queue. Defaults to `vasto_jobs`.
   */
  tableName?: string;

  /**
   * Table name for dead-letter jobs. Defaults to `vasto_dead_letter`.
   */
  deadLetterTableName?: string;

  /**
   * @deprecated Completed jobs now remain in the main jobs table.
   * This option is retained for backwards compatibility and is ignored.
   */
  completedTableName?: string;

  /**
   * Retention period for archive rows in milliseconds.
   */
  archiveRetentionMs?: number;

  /**
   * Maximum archive rows to keep per queue.
   */
  archiveMaxRowsPerQueue?: number;

  /**
   * Partition jobs table by queue using LIST partitioning.
   * Useful for high queue cardinality and heavy queue-local polling patterns.
   */
  partitionByQueue?: boolean;

  /**
   * Whether to persist completed job history.
   * Disable this in throughput-focused benchmarks to avoid per-job completion write overhead.
   */
  trackCompletedJobs?: boolean;
}

function ensureSqlIdentifier(name: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid ${label}: ${name}. Only letters, numbers, and underscores are allowed.`);
  }

  return name;
}

function canUseMinimalEnqueue(job: StoredJob): boolean {
  return (
    job.state === 'queued' &&
    job.attempts === 0 &&
    job.maxAttempts == null &&
    job.idempotencyKey == null &&
    job.delayUntil == null &&
    job.scheduledCron == null &&
    job.lastScheduledAt == null &&
    job.progress == null &&
    (job.priority == null || job.priority === 'normal')
  );
}

interface PendingAckBatch {
  queueName: string | undefined;
  jobIds: string[];
  resolvers: Array<() => void>;
  rejecters: Array<(error: unknown) => void>;
  flushHandle: ReturnType<typeof setImmediate> | undefined;
}

export class PostgresStore implements QueueStorage {
  private pool: Pool;
  private table: string;
  private dlTable: string;
  private archiveRetentionMs: number | undefined;
  private archiveMaxRowsPerQueue: number;
  private partitionByQueue: boolean;
  private knownQueuePartitions = new Set<string>();
  private dequeueExplainLogged = false;
  private completedPruneTick = 0;
  private static readonly COMPLETED_PRUNE_INTERVAL = 500;
  private trackCompletedJobs: boolean;
  private statementPrefix: string;
  private pendingAckBatches = new Map<string, PendingAckBatch>();

  constructor(config: PostgresStoreConfig) {
    this.pool = config.pool instanceof Pool ? config.pool : new Pool(config.pool);
    this.table = ensureSqlIdentifier(config.tableName ?? 'vasto_jobs', 'tableName');
    this.dlTable = ensureSqlIdentifier(config.deadLetterTableName ?? 'vasto_dead_letter', 'deadLetterTableName');
    this.archiveRetentionMs =
      typeof config.archiveRetentionMs === 'number' && Number.isFinite(config.archiveRetentionMs) && config.archiveRetentionMs > 0
        ? Math.floor(config.archiveRetentionMs)
        : undefined;
    this.archiveMaxRowsPerQueue =
      typeof config.archiveMaxRowsPerQueue === 'number' && Number.isFinite(config.archiveMaxRowsPerQueue) && config.archiveMaxRowsPerQueue > 0
        ? Math.floor(config.archiveMaxRowsPerQueue)
        : 500;
    this.partitionByQueue = config.partitionByQueue === true;
    this.trackCompletedJobs = config.trackCompletedJobs !== false;
    this.statementPrefix = `vasto_${createHash('sha1').update(`${this.table}:${this.dlTable}`).digest('hex').slice(0, 8)}`;
  }

  private statementName(suffix: string): string {
    return `${this.statementPrefix}_${suffix}`;
  }

  /**
   * Creates the required tables if they do not already exist.
   * Call this once during application startup.
   */
  async migrate(): Promise<void> {
    const createJobsTable = this.partitionByQueue
      ? `
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id                TEXT        NOT NULL,
        name              TEXT        NOT NULL,
        payload           JSONB       NOT NULL,
        queue             TEXT        NOT NULL,
        state             TEXT        NOT NULL DEFAULT 'queued',
        attempts          INTEGER     NOT NULL DEFAULT 0,
        max_attempts      INTEGER,
        idempotency_key   TEXT,
        delay_until       BIGINT,
        scheduled_cron    TEXT,
        last_scheduled_at BIGINT,
        priority          TEXT        NOT NULL DEFAULT 'normal',
        progress          INTEGER,
        lease_until       TIMESTAMPTZ,
        created_at        BIGINT      NOT NULL,
        updated_at        BIGINT      NOT NULL,
        PRIMARY KEY (queue, id)
      ) PARTITION BY LIST (queue);

      CREATE TABLE IF NOT EXISTS ${this.getDefaultPartitionName()}
      PARTITION OF ${this.table} DEFAULT;
      `
      : `
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id                TEXT        PRIMARY KEY,
        name              TEXT        NOT NULL,
        payload           JSONB       NOT NULL,
        queue             TEXT        NOT NULL,
        state             TEXT        NOT NULL DEFAULT 'queued',
        attempts          INTEGER     NOT NULL DEFAULT 0,
        max_attempts      INTEGER,
        idempotency_key   TEXT,
        delay_until       BIGINT,
        scheduled_cron    TEXT,
        last_scheduled_at BIGINT,
        priority          TEXT        NOT NULL DEFAULT 'normal',
        progress          INTEGER,
        lease_until       TIMESTAMPTZ,
        created_at        BIGINT      NOT NULL,
        updated_at        BIGINT      NOT NULL
      );
      `;

    await this.pool.query(`
      ${createJobsTable}

      ALTER TABLE ${this.table}
        ADD COLUMN IF NOT EXISTS delay_until BIGINT;

      ALTER TABLE ${this.table}
        ADD COLUMN IF NOT EXISTS scheduled_cron TEXT;

      ALTER TABLE ${this.table}
        ADD COLUMN IF NOT EXISTS last_scheduled_at BIGINT;

      ALTER TABLE ${this.table}
        ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';

      ALTER TABLE ${this.table}
        ADD COLUMN IF NOT EXISTS progress INTEGER;

      ALTER TABLE ${this.table}
        ADD COLUMN IF NOT EXISTS completed_at BIGINT;

      ALTER TABLE ${this.table}
        ADD COLUMN IF NOT EXISTS result JSONB;

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_state
        ON ${this.table} (queue, state, created_at);

      CREATE INDEX IF NOT EXISTS idx_${this.table}_id
        ON ${this.table} (id);

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_id
        ON ${this.table} (queue, id);

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_priority
        ON ${this.table} (
          queue,
          state,
          (CASE priority
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 2
          END),
          created_at
        );

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_ready_fetch
        ON ${this.table} (
          queue,
          (CASE priority
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 2
          END),
          created_at,
          id
        )
        WHERE state = 'queued' AND delay_until IS NULL;

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_delay
        ON ${this.table} (queue, delay_until)
        WHERE delay_until IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_completed_at
        ON ${this.table} (queue, completed_at DESC)
        WHERE state = 'completed';

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_leased_until
        ON ${this.table} (queue, lease_until)
        WHERE state = 'leased';

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_leased_fetch
        ON ${this.table} (queue, lease_until, created_at, id)
        WHERE state = 'leased';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.table}_idempotency
        ON ${this.table} (queue, idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ${this.dlTable} (
        id          TEXT    PRIMARY KEY,
        name        TEXT    NOT NULL,
        payload     JSONB   NOT NULL,
        queue       TEXT    NOT NULL,
        attempts    INTEGER NOT NULL DEFAULT 0,
        created_at  BIGINT  NOT NULL,
        failed_at   BIGINT  NOT NULL,
        error_details JSONB,
        retried_at BIGINT,
        retried_job_id TEXT
      );

      ALTER TABLE ${this.dlTable}
        ADD COLUMN IF NOT EXISTS error_details JSONB;

      ALTER TABLE ${this.dlTable}
        ADD COLUMN IF NOT EXISTS retried_at BIGINT;

      ALTER TABLE ${this.dlTable}
        ADD COLUMN IF NOT EXISTS retried_job_id TEXT;

    `);
  }

  async enqueue(job: StoredJob): Promise<void> {
    await this.ensureQueuePartition(job.queue);

    if (canUseMinimalEnqueue(job)) {
      await this.pool.query(
        {
          name: this.statementName('enqueue_minimal'),
          text: `
        INSERT INTO ${this.table}
          (id, name, payload, queue, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
          values: [job.id, job.name, job.payload, job.queue, job.createdAt, job.updatedAt],
        },
      );
      return;
    }

    await this.pool.query(
      {
        name: this.statementName('enqueue_full'),
        text: `
      INSERT INTO ${this.table}
        (id, name, payload, queue, state, attempts, max_attempts, idempotency_key, delay_until, scheduled_cron, last_scheduled_at, priority, progress, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT DO NOTHING
      `,
        values: [
        job.id,
        job.name,
        job.payload,
        job.queue,
        job.state,
        job.attempts,
        job.maxAttempts ?? null,
        job.idempotencyKey ?? null,
        job.delayUntil ?? null,
        job.scheduledCron ?? null,
        job.lastScheduledAt ?? null,
        job.priority ?? 'normal',
        job.progress ?? null,
        job.createdAt,
        job.updatedAt,
      ],
      }
    );
  }

  async enqueueBatch(jobs: StoredJob[]): Promise<void> {
    if (jobs.length === 0) {
      return;
    }

    if (this.partitionByQueue) {
      const queueNames = Array.from(new Set(jobs.map((job) => job.queue)));
      await Promise.all(queueNames.map((queueName) => this.ensureQueuePartition(queueName)));
    }

    if (jobs.every(canUseMinimalEnqueue)) {
      const payload = JSON.stringify(
        jobs.map((job) => ({
          id: job.id,
          name: job.name,
          payload: job.payload,
          queue: job.queue,
          created_at: job.createdAt,
          updated_at: job.updatedAt,
        })),
      );

      await this.pool.query(
        {
          name: this.statementName('enqueue_batch_minimal'),
          text: `
        INSERT INTO ${this.table}
          (id, name, payload, queue, created_at, updated_at)
        SELECT
          id,
          name,
          payload,
          queue,
          created_at,
          updated_at
        FROM json_to_recordset($1::json) AS j(
          id text,
          name text,
          payload jsonb,
          queue text,
          created_at bigint,
          updated_at bigint
        )
        `,
          values: [payload],
        },
      );
      return;
    }

    const payload = JSON.stringify(
      jobs.map((job) => ({
        id: job.id,
        name: job.name,
        payload: job.payload,
        queue: job.queue,
        state: job.state,
        attempts: job.attempts,
        max_attempts: job.maxAttempts ?? null,
        idempotency_key: job.idempotencyKey ?? null,
        delay_until: job.delayUntil ?? null,
        scheduled_cron: job.scheduledCron ?? null,
        last_scheduled_at: job.lastScheduledAt ?? null,
        priority: job.priority ?? 'normal',
        progress: job.progress ?? null,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
      })),
    );

    await this.pool.query(
      {
        name: this.statementName('enqueue_batch_full'),
        text: `
      INSERT INTO ${this.table}
        (id, name, payload, queue, state, attempts, max_attempts, idempotency_key, delay_until, scheduled_cron, last_scheduled_at, priority, progress, created_at, updated_at)
      SELECT
        id,
        name,
        payload,
        queue,
        state,
        attempts,
        max_attempts,
        idempotency_key,
        delay_until,
        scheduled_cron,
        last_scheduled_at,
        priority,
        progress,
        created_at,
        updated_at
      FROM json_to_recordset($1::json) AS j(
        id text,
        name text,
        payload jsonb,
        queue text,
        state text,
        attempts integer,
        max_attempts integer,
        idempotency_key text,
        delay_until bigint,
        scheduled_cron text,
        last_scheduled_at bigint,
        priority text,
        progress integer,
        created_at bigint,
        updated_at bigint
      )
      ON CONFLICT DO NOTHING
      `,
        values: [payload],
      },
    );
  }

  async dequeue(options: LeaseOptions): Promise<StoredJob[]> {
    const { queue, batchSize, leaseMs } = options;
    const leaseUntil = new Date(Date.now() + leaseMs);
    const nowMs = Date.now();

    if (queue) {
      const queueQuery = `
        WITH candidates AS (
          SELECT
            ctid AS row_tid,
            CASE WHEN state = 'queued' THEN 0 ELSE 1 END AS bucket,
            CASE priority
              WHEN 'critical' THEN 0
              WHEN 'high' THEN 1
              WHEN 'normal' THEN 2
              WHEN 'low' THEN 3
              ELSE 2
            END AS prio,
            created_at,
            id
          FROM ${this.table}
          WHERE queue = $1
            AND (
              (state = 'queued' AND delay_until IS NULL)
              OR (state = 'leased' AND lease_until < NOW())
            )
          ORDER BY bucket ASC, prio ASC, created_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        ),
        updated AS (
          UPDATE ${this.table} t
          SET state = 'leased',
              lease_until = $3,
              updated_at = $4
          FROM candidates c
          WHERE t.ctid = c.row_tid
          RETURNING t.*, c.bucket, c.prio, c.created_at AS candidate_created_at, c.id AS candidate_id
        )
        SELECT *
        FROM updated
        ORDER BY bucket ASC, prio ASC, candidate_created_at ASC, candidate_id ASC
      `;

      await this.logDequeueExplainOnce(queueQuery, [queue, batchSize, leaseUntil, nowMs]);

      const result = await this.pool.query(
        {
          name: this.statementName('dequeue_queue'),
          text: queueQuery,
          values: [queue, batchSize, leaseUntil, nowMs],
        },
      );

      return result.rows.map((row) => this.rowToJob(row));
    }

    const globalQuery = `
      WITH candidates AS (
        SELECT
          ctid AS row_tid,
          CASE WHEN state = 'queued' THEN 0 ELSE 1 END AS bucket,
          CASE priority
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 2
          END AS prio,
          created_at,
          id
        FROM ${this.table}
        WHERE (state = 'queued' AND delay_until IS NULL)
           OR (state = 'leased' AND lease_until < NOW())
        ORDER BY bucket ASC, prio ASC, created_at ASC, id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      ),
      updated AS (
        UPDATE ${this.table} t
        SET state = 'leased',
            lease_until = $2,
            updated_at = $3
        FROM candidates c
        WHERE t.ctid = c.row_tid
        RETURNING t.*, c.bucket, c.prio, c.created_at AS candidate_created_at, c.id AS candidate_id
      )
      SELECT *
      FROM updated
      ORDER BY bucket ASC, prio ASC, candidate_created_at ASC, candidate_id ASC
    `;

    await this.logDequeueExplainOnce(globalQuery, [batchSize, leaseUntil, nowMs]);

    const result = await this.pool.query({
      name: this.statementName('dequeue_global'),
      text: globalQuery,
      values: [batchSize, leaseUntil, nowMs],
    });

    return result.rows.map((row) => this.rowToJob(row));
  }

  async ack(jobId: string, queueName?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const batchKey = queueName ?? '*';
      let batch = this.pendingAckBatches.get(batchKey);

      if (!batch) {
        batch = {
          queueName,
          jobIds: [],
          resolvers: [],
          rejecters: [],
          flushHandle: undefined,
        };
        this.pendingAckBatches.set(batchKey, batch);
      }

      batch.jobIds.push(jobId);
      batch.resolvers.push(resolve);
      batch.rejecters.push(reject);

      if (!batch.flushHandle) {
        batch.flushHandle = setImmediate(() => {
          void this.flushAckBatch(batchKey);
        });
      }
    });
  }

  private async flushAckBatch(batchKey: string): Promise<void> {
    const batch = this.pendingAckBatches.get(batchKey);
    if (!batch) {
      return;
    }

    this.pendingAckBatches.delete(batchKey);
    batch.flushHandle = undefined;

    const jobIds = Array.from(new Set(batch.jobIds));

    try {
      if (batch.queueName) {
        await this.pool.query({
          name: this.statementName('ack_queue_batch'),
          text: `DELETE FROM ${this.table} WHERE queue = $1 AND id = ANY($2::text[])`,
          values: [batch.queueName, jobIds],
        });
      } else {
        await this.pool.query({
          name: this.statementName('ack_global_batch'),
          text: `DELETE FROM ${this.table} WHERE id = ANY($1::text[])`,
          values: [jobIds],
        });
      }

      for (const resolve of batch.resolvers) {
        resolve();
      }
    } catch (error) {
      for (const reject of batch.rejecters) {
        reject(error);
      }
    }
  }

  async fail(jobId: string, err: Error): Promise<void> {
    await this.pool.query({
      name: this.statementName('fail_job'),
      text: `
      UPDATE ${this.table}
      SET state      = 'failed',
          updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id = $1
      `,
      values: [jobId],
    });

    // Persist error message as a notice — non-critical, best effort
    console.error(`[PostgresStore] Job ${jobId} failed: ${err.message}`);
  }

  async moveToDeadLetter(job: StoredJob): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        {
          name: this.statementName('move_to_dead_letter_insert'),
          text: `
        INSERT INTO ${this.dlTable} (id, name, payload, queue, attempts, created_at, failed_at, error_details, retried_at, retried_job_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL)
        ON CONFLICT (id) DO NOTHING
        `,
          values: [
          job.id,
          job.name,
          JSON.stringify(job.payload),
          job.queue,
          job.attempts,
          job.createdAt,
          Date.now(),
          job.errorDetails ? JSON.stringify(job.errorDetails) : null,
        ],
        },
      );

      await client.query({
        name: this.statementName('move_to_dead_letter_delete_source'),
        text: `DELETE FROM ${this.table} WHERE id = $1`,
        values: [job.id],
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getQueueDepth(queue: string): Promise<number> {
    const result = await this.pool.query({
      name: this.statementName('get_queue_depth'),
      text: `
      SELECT COUNT(*) AS count
      FROM ${this.table}
      WHERE queue = $1
        AND state IN ('queued', 'leased')
      `,
      values: [queue],
    });

    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async extendLease(jobId: string, leaseMs: number, queueName?: string): Promise<void> {
    const leaseUntil = new Date(Date.now() + leaseMs);

    if (queueName) {
      await this.pool.query({
        name: this.statementName('extend_lease_queue'),
        text: `
        UPDATE ${this.table}
        SET lease_until = $2,
            updated_at  = EXTRACT(EPOCH FROM NOW()) * 1000
        WHERE id = $1
          AND queue = $3
        `,
        values: [jobId, leaseUntil, queueName],
      });
      return;
    }

    await this.pool.query({
      name: this.statementName('extend_lease_global'),
      text: `
      UPDATE ${this.table}
      SET lease_until = $2,
          updated_at  = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id = $1
      `,
      values: [jobId, leaseUntil],
    });
  }

  async updateAttempts(id: string, attempts: number): Promise<void> {
    await this.pool.query({
      name: this.statementName('update_attempts'),
      text: `
      UPDATE ${this.table}
      SET attempts   = $2,
          updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id = $1
      `,
      values: [id, attempts],
    });
  }

  async getDelayedJobs(queueName: string, beforeDate: number): Promise<StoredJob[]> {
    const result = await this.pool.query({
      name: this.statementName('get_delayed_jobs'),
      text: `
      SELECT *
      FROM ${this.table}
      WHERE queue = $1
        AND state = 'queued'
        AND delay_until IS NOT NULL
        AND delay_until <= $2
      ORDER BY delay_until ASC, created_at ASC
      `,
      values: [queueName, beforeDate],
    });

    return result.rows.map((row) => this.rowToJob(row));
  }

  async getNextDelayedTimestamp(queueName: string): Promise<number | undefined> {
    const result = await this.pool.query({
      name: this.statementName('next_delayed_ts'),
      text: `
      SELECT MIN(delay_until) AS next_delay_until
      FROM ${this.table}
      WHERE queue = $1
        AND state = 'queued'
        AND delay_until IS NOT NULL
      `,
      values: [queueName],
    });

    const value = result.rows[0]?.['next_delay_until'];
    if (value == null) {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  async promoteDelayedJobs(queueName: string, beforeDate: number, limit: number = 256): Promise<StoredJob[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const now = Date.now();
    const result = await this.pool.query({
      name: this.statementName('promote_delayed_jobs'),
      text: `
      WITH candidates AS (
        SELECT ctid AS row_tid
        FROM ${this.table}
        WHERE queue = $1
          AND state = 'queued'
          AND delay_until IS NOT NULL
          AND delay_until <= $2
        ORDER BY delay_until ASC, created_at ASC
        LIMIT $3
        FOR UPDATE SKIP LOCKED
      ),
      promoted AS (
        UPDATE ${this.table} t
        SET delay_until = NULL,
            updated_at = $4
        FROM candidates c
        WHERE t.ctid = c.row_tid
        RETURNING t.*
      )
      SELECT *
      FROM promoted
      ORDER BY created_at ASC, id ASC
      `,
      values: [queueName, beforeDate, safeLimit, now],
    });

    return result.rows.map((row) => this.rowToJob(row));
  }

  async moveJobToQueue(
    queueName: string,
    jobId: string,
    toState: 'active' | 'deferred' | 'failed'
  ): Promise<void> {
    if (toState === 'active') {
      await this.pool.query(
        `
        UPDATE ${this.table}
        SET state = 'queued',
            delay_until = NULL,
            updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
        WHERE id = $1 AND queue = $2
        `,
        [jobId, queueName]
      );
      return;
    }

    if (toState === 'failed') {
      await this.pool.query(
        `
        UPDATE ${this.table}
        SET state = 'failed',
            updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
        WHERE id = $1 AND queue = $2
        `,
        [jobId, queueName]
      );
      return;
    }

    await this.pool.query(
      `
      UPDATE ${this.table}
      SET state = 'queued',
          updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id = $1 AND queue = $2
      `,
      [jobId, queueName]
    );
  }

  async queryDeferredJobs(query: {
    queueName?: string;
    status?: 'pending' | 'promoted' | 'failed';
    limit?: number;
    offset?: number;
  }): Promise<StoredJob[]> {
    const conditions: string[] = ['delay_until IS NOT NULL'];
    const values: Array<string | number> = [];
    let index = 1;

    if (query.queueName) {
      conditions.push(`queue = $${index++}`);
      values.push(query.queueName);
    }

    if (query.status === 'pending') {
      conditions.push(`state = 'queued'`);
      conditions.push(`delay_until > $${index++}`);
      values.push(Date.now());
    } else if (query.status === 'failed') {
      conditions.push(`state = 'failed'`);
    } else if (query.status === 'promoted') {
      conditions.push(`state = 'queued'`);
      conditions.push(`delay_until <= $${index++}`);
      values.push(Date.now());
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const result = await this.pool.query(
      `
      SELECT *
      FROM ${this.table}
      WHERE ${conditions.join(' AND ')}
      ORDER BY delay_until ASC, created_at ASC
      LIMIT $${index++} OFFSET $${index}
      `,
      values
    );

    return result.rows.map((row) => this.rowToJob(row));
  }

  // Dead Letter Queue (Phase 1.4)
  async getDeadLetterJobs(query: {
    queueName?: string;
    limit?: number;
    offset?: number;
  }): Promise<StoredJob[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    let index = 1;

    if (query.queueName) {
      conditions.push(`queue = $${index++}`);
      values.push(query.queueName);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const result = await this.pool.query(
      `
      SELECT *
      FROM ${this.dlTable}
      ${whereClause}
      ORDER BY failed_at DESC
      LIMIT $${index++} OFFSET $${index}
      `,
      values
    );

    return result.rows.map((row) => {
      const errorDetails = row['error_details'];

      return {
        id: row['id'] as string,
        name: row['name'] as string,
        payload: row['payload'],
        queue: row['queue'] as string,
        state: 'failed' as const,
        attempts: Number(row['attempts'] ?? 0),
        createdAt: Number(row['created_at']),
        updatedAt: Number(row['failed_at']),
        ...(errorDetails != null
          ? { errorDetails: errorDetails as NonNullable<StoredJob['errorDetails']> }
          : {}),
        ...(row['retried_at'] != null ? { retriedAt: Number(row['retried_at']) } : {}),
        ...(row['retried_job_id'] != null ? { retriedJobId: row['retried_job_id'] as string } : {}),
      };
    });
  }

  async retryDeadLetterJob(queueName: string, jobId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const deadResult = await client.query(
        `SELECT * FROM ${this.dlTable} WHERE id = $1 AND queue = $2 AND retried_at IS NULL FOR UPDATE`,
        [jobId, queueName]
      );

      const row = deadResult.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return false;
      }

      const now = Date.now();
      const retriedJobId = crypto.randomUUID();
      await client.query(
        `
        INSERT INTO ${this.table}
          (id, name, payload, queue, state, attempts, max_attempts, idempotency_key, delay_until, scheduled_cron, last_scheduled_at, priority, progress, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'queued', 0, NULL, NULL, NULL, NULL, NULL, 'normal', NULL, $5, $6)
        ON CONFLICT DO NOTHING
        `,
        [retriedJobId, row['name'], row['payload'], row['queue'], now, now]
      );

      await client.query(
        `UPDATE ${this.dlTable} SET retried_at = $3, retried_job_id = $4, failed_at = $3 WHERE id = $1 AND queue = $2`,
        [jobId, queueName, now, retriedJobId]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async promoteJob(queueName: string, jobId: string): Promise<boolean> {
    const result = await this.pool.query(
      `
      UPDATE ${this.table}
      SET state = 'queued',
          delay_until = NULL,
          updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id = $1
        AND queue = $2
        AND state = 'queued'
        AND delay_until IS NOT NULL
      `,
      [jobId, queueName]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const [jobsResult, dlqResult] = await Promise.all([
        client.query(`DELETE FROM ${this.table} WHERE id = $1 AND queue = $2`, [jobId, queueName]),
        client.query(`DELETE FROM ${this.dlTable} WHERE id = $1 AND queue = $2`, [jobId, queueName]),
      ]);

      await client.query('COMMIT');
      return (jobsResult.rowCount ?? 0) + (dlqResult.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cleanJobs(queueName: string, options: QueueCleanOptions = {}): Promise<number> {
    const status = options.status ?? 'all';
    const cutoff = Date.now() - Math.max(0, options.graceMs ?? 0);
    const limit = options.limit ?? 1000;

    const statuses: QueueAdminJobStatus[] =
      status === 'all' ? ['ready', 'active', 'deferred', 'failed', 'completed'] : [status];

    let removed = 0;
    for (const currentStatus of statuses) {
      if (removed >= limit) break;

      const count = await this.cleanByStatus(queueName, currentStatus, cutoff, limit - removed);
      removed += count;
    }

    return removed;
  }

  async obliterateQueue(queueName: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const [jobsResult, dlqResult] = await Promise.all([
        client.query(`DELETE FROM ${this.table} WHERE queue = $1`, [queueName]),
        client.query(`DELETE FROM ${this.dlTable} WHERE queue = $1`, [queueName]),
      ]);

      await client.query('COMMIT');
      return (jobsResult.rowCount ?? 0) + (dlqResult.rowCount ?? 0);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Progress tracking (Phase 1.3)
  async setJobProgress(jobId: string, progress: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE ${this.table}
      SET progress   = $2,
          updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id = $1
      `,
      [jobId, progress]
    );
  }

  // Ready and Active job visibility (Phase 2)
  async getReadyJobs(query: ReadyJobsQuery): Promise<StoredJob[]> {
    const values: Array<string | number> = [];
    const conditions: string[] = ["state = 'queued'", 'delay_until IS NULL'];
    let index = 1;

    if (query.queueName) {
      conditions.push(`queue = $${index++}`);
      values.push(query.queueName);
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const result = await this.pool.query(
      `
      SELECT *
      FROM ${this.table}
      WHERE ${conditions.join(' AND ')}
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
          ELSE 2
        END ASC,
        created_at ASC
      LIMIT $${index++} OFFSET $${index}
      `,
      values
    );

    return result.rows.map((row) => this.rowToJob(row));
  }

  async getActiveJobs(query: ActiveJobsQuery): Promise<StoredJob[]> {
    const values: Array<string | number> = [];
    const conditions: string[] = ["state = 'leased'"];
    let index = 1;

    if (query.queueName) {
      conditions.push(`queue = $${index++}`);
      values.push(query.queueName);
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const result = await this.pool.query(
      `
      SELECT *
      FROM ${this.table}
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at ASC, created_at ASC
      LIMIT $${index++} OFFSET $${index}
      `,
      values
    );

    return result.rows.map((row) => this.rowToJob(row));
  }

  // Completed job history (Horizon-style)
  async addCompletedJob(job: StoredJob, result?: unknown): Promise<void> {
    if (!this.trackCompletedJobs) {
      return;
    }

    const completedAt = Date.now();
    await this.pool.query(
      `
      UPDATE ${this.table}
      SET state = 'completed',
          completed_at = $2,
          result = $3,
          updated_at = $2
      WHERE id = $1
      `,
      [job.id, completedAt, result !== undefined ? JSON.stringify(result) : null]
    );

    this.completedPruneTick += 1;
    if (this.completedPruneTick % PostgresStore.COMPLETED_PRUNE_INTERVAL !== 0) {
      return;
    }

    await this.pool.query(
      `
      DELETE FROM ${this.table}
      WHERE id IN (
        SELECT id
        FROM ${this.table}
        WHERE queue = $1
          AND state = 'completed'
        ORDER BY completed_at DESC
        OFFSET $2
      )
      `,
      [job.queue, this.archiveMaxRowsPerQueue]
    );

    if (this.archiveRetentionMs != null) {
      await this.pool.query(
        `
        DELETE FROM ${this.table}
        WHERE state = 'completed'
          AND completed_at IS NOT NULL
          AND completed_at < $1
        `,
        [Date.now() - this.archiveRetentionMs]
      );
    }
  }

  async getCompletedJobs(query: CompletedJobsQuery): Promise<CompletedJobRecord[]> {
    const values: Array<string | number> = [];
    const conditions: string[] = ["state = 'completed'", 'completed_at IS NOT NULL'];
    let index = 1;

    if (query.queueName) {
      conditions.push(`queue = $${index++}`);
      values.push(query.queueName);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const result = await this.pool.query(
      `
      SELECT *
      FROM ${this.table}
      ${whereClause}
      ORDER BY completed_at DESC
      LIMIT $${index++} OFFSET $${index}
      `,
      values
    );

    return result.rows.map((row) => this.rowToCompletedJob(row));
  }

  async queryJobArchive(query: JobArchiveQuery): Promise<CompletedJobRecord[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    let index = 1;

    conditions.push("state = 'completed'");
    conditions.push('completed_at IS NOT NULL');

    if (query.queueName) {
      conditions.push(`queue = $${index++}`);
      values.push(query.queueName);
    }

    if (query.jobName) {
      conditions.push(`name = $${index++}`);
      values.push(query.jobName);
    }

    if (query.fromTs != null) {
      conditions.push(`completed_at >= $${index++}`);
      values.push(query.fromTs);
    }

    if (query.toTs != null) {
      conditions.push(`completed_at <= $${index++}`);
      values.push(query.toTs);
    }

    if (query.search) {
      conditions.push(`(name ILIKE $${index} OR payload::text ILIKE $${index} OR COALESCE(result::text, '') ILIKE $${index})`);
      values.push(`%${query.search}%`);
      index += 1;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const result = await this.pool.query(
      `
      SELECT *
      FROM ${this.table}
      ${whereClause}
      ORDER BY completed_at DESC
      LIMIT $${index++} OFFSET $${index}
      `,
      values
    );

    return result.rows.map((row) => this.rowToCompletedJob(row));
  }

  setArchiveRetentionPolicy(policy: ArchiveRetentionPolicy): void {
    if (typeof policy.retentionMs === 'number' && Number.isFinite(policy.retentionMs) && policy.retentionMs > 0) {
      this.archiveRetentionMs = Math.floor(policy.retentionMs);
    }

    if (typeof policy.maxRowsPerQueue === 'number' && Number.isFinite(policy.maxRowsPerQueue) && policy.maxRowsPerQueue > 0) {
      this.archiveMaxRowsPerQueue = Math.floor(policy.maxRowsPerQueue);
    }
  }

  /**
   * Close the underlying connection pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private rowToJob(row: Record<string, unknown>): StoredJob {
    const job: StoredJob = {
      id: row['id'] as string,
      name: row['name'] as string,
      payload: row['payload'],
      queue: row['queue'] as string,
      state: row['state'] as StoredJob['state'],
      attempts: row['attempts'] as number,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };

    if (row['max_attempts'] != null) {
      job.maxAttempts = row['max_attempts'] as number;
    }

    if (row['idempotency_key'] != null) {
      job.idempotencyKey = row['idempotency_key'] as string;
    }

    if (row['delay_until'] != null) {
      job.delayUntil = Number(row['delay_until']);
    }

    if (row['scheduled_cron'] != null) {
      job.scheduledCron = row['scheduled_cron'] as string;
    }

    if (row['last_scheduled_at'] != null) {
      job.lastScheduledAt = Number(row['last_scheduled_at']);
    }

    if (row['priority'] != null) {
      job.priority = row['priority'] as 'critical' | 'high' | 'normal' | 'low';
    }

    if (row['progress'] != null) {
      job.progress = Number(row['progress']);
    }

    return job;
  }

  private rowToCompletedJob(row: Record<string, unknown>): CompletedJobRecord {
    const base = this.rowToJob(row);

    return {
      ...base,
      state: 'completed',
      completedAt: Number(row['completed_at'] ?? base.updatedAt),
      ...(row['result'] !== undefined && row['result'] !== null ? { result: row['result'] } : {}),
    };
  }

  private async cleanByStatus(
    queueName: string,
    status: QueueAdminJobStatus,
    cutoff: number,
    limit: number
  ): Promise<number> {
    if (limit <= 0) return 0;

    if (status === 'ready') {
      const result = await this.pool.query(
        `
        WITH candidates AS (
          SELECT id
          FROM ${this.table}
          WHERE queue = $1
            AND state = 'queued'
            AND delay_until IS NULL
            AND updated_at <= $2
          LIMIT $3
        )
        DELETE FROM ${this.table}
        WHERE id IN (SELECT id FROM candidates)
        `,
        [queueName, cutoff, limit]
      );
      return result.rowCount ?? 0;
    }

    if (status === 'active') {
      const result = await this.pool.query(
        `
        WITH candidates AS (
          SELECT id
          FROM ${this.table}
          WHERE queue = $1
            AND state = 'leased'
            AND updated_at <= $2
          LIMIT $3
        )
        DELETE FROM ${this.table}
        WHERE id IN (SELECT id FROM candidates)
        `,
        [queueName, cutoff, limit]
      );
      return result.rowCount ?? 0;
    }

    if (status === 'deferred') {
      const result = await this.pool.query(
        `
        WITH candidates AS (
          SELECT id
          FROM ${this.table}
          WHERE queue = $1
            AND delay_until IS NOT NULL
            AND updated_at <= $2
          LIMIT $3
        )
        DELETE FROM ${this.table}
        WHERE id IN (SELECT id FROM candidates)
        `,
        [queueName, cutoff, limit]
      );
      return result.rowCount ?? 0;
    }

    if (status === 'failed') {
      const result = await this.pool.query(
        `
        WITH candidates AS (
          SELECT id
          FROM ${this.dlTable}
          WHERE queue = $1
            AND failed_at <= $2
          LIMIT $3
        )
        DELETE FROM ${this.dlTable}
        WHERE id IN (SELECT id FROM candidates)
        `,
        [queueName, cutoff, limit]
      );
      return result.rowCount ?? 0;
    }

    if (status === 'completed') {
      const result = await this.pool.query(
        `
        WITH candidates AS (
          SELECT id
          FROM ${this.table}
          WHERE queue = $1
            AND state = 'completed'
            AND COALESCE(completed_at, updated_at) <= $2
          LIMIT $3
        )
        DELETE FROM ${this.table}
        WHERE id IN (SELECT id FROM candidates)
        `,
        [queueName, cutoff, limit]
      );
      return result.rowCount ?? 0;
    }

    return 0;
  }

  private getDefaultPartitionName(): string {
    return `${this.table}_default`;
  }

  private getPartitionName(queueName: string): string {
    const suffix = createHash('sha1').update(queueName).digest('hex').slice(0, 12);
    return `${this.table}_q_${suffix}`;
  }

  private sqlLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private async ensureQueuePartition(queueName: string): Promise<void> {
    if (!this.partitionByQueue || this.knownQueuePartitions.has(queueName)) {
      return;
    }

    const partitionName = this.getPartitionName(queueName);
    await this.pool.query(
      `
      CREATE TABLE IF NOT EXISTS ${partitionName}
      PARTITION OF ${this.table}
      FOR VALUES IN (${this.sqlLiteral(queueName)})
      `,
    );

    this.knownQueuePartitions.add(queueName);
  }

  private async logDequeueExplainOnce(query: string, values: unknown[]): Promise<void> {
    if (this.dequeueExplainLogged || process.env['VASTO_BENCH_EXPLAIN_DEQUEUE'] == null) {
      return;
    }

    try {
      const result = await this.pool.query(`EXPLAIN ${query}`, values);
      this.dequeueExplainLogged = true;
      const plan = result.rows.map((row) => String(row['QUERY PLAN'] ?? '')).join('\n');
      console.log(`[PostgresStore] dequeue EXPLAIN plan:\n${plan}`);
    } catch (error) {
      console.warn(`[PostgresStore] dequeue EXPLAIN failed: ${(error as Error).message}`);
    }
  }
}
