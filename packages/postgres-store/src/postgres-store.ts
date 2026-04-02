import { Pool, PoolConfig } from 'pg';
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
} from '@omni-queue/core';

export interface PostgresStoreConfig {
  /**
   * A pre-configured `pg` Pool instance, or PoolConfig to create one.
   */
  pool: Pool | PoolConfig;

  /**
   * Table name for the jobs queue. Defaults to `omni_queue_jobs`.
   */
  tableName?: string;

  /**
   * Table name for dead-letter jobs. Defaults to `omni_queue_dead_letter`.
   */
  deadLetterTableName?: string;

  /**
   * Table name for completed jobs history. Defaults to `omni_queue_completed`.
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
}

export class PostgresStore implements QueueStorage {
  private pool: Pool;
  private table: string;
  private dlTable: string;
  private completedTable: string;
  private archiveRetentionMs: number | undefined;
  private archiveMaxRowsPerQueue: number;

  constructor(config: PostgresStoreConfig) {
    this.pool = config.pool instanceof Pool ? config.pool : new Pool(config.pool);
    this.table = config.tableName ?? 'omni_queue_jobs';
    this.dlTable = config.deadLetterTableName ?? 'omni_queue_dead_letter';
    this.completedTable = config.completedTableName ?? 'omni_queue_completed';
    this.archiveRetentionMs =
      typeof config.archiveRetentionMs === 'number' && Number.isFinite(config.archiveRetentionMs) && config.archiveRetentionMs > 0
        ? Math.floor(config.archiveRetentionMs)
        : undefined;
    this.archiveMaxRowsPerQueue =
      typeof config.archiveMaxRowsPerQueue === 'number' && Number.isFinite(config.archiveMaxRowsPerQueue) && config.archiveMaxRowsPerQueue > 0
        ? Math.floor(config.archiveMaxRowsPerQueue)
        : 500;
  }

  /**
   * Creates the required tables if they do not already exist.
   * Call this once during application startup.
   */
  async migrate(): Promise<void> {
    await this.pool.query(`
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

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_state
        ON ${this.table} (queue, state, created_at);

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

      CREATE INDEX IF NOT EXISTS idx_${this.table}_queue_delay
        ON ${this.table} (queue, delay_until)
        WHERE delay_until IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.table}_idempotency
        ON ${this.table} (idempotency_key)
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

      CREATE TABLE IF NOT EXISTS ${this.completedTable} (
        id           TEXT    PRIMARY KEY,
        queue        TEXT    NOT NULL,
        completed_at BIGINT  NOT NULL,
        record       JSONB   NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_${this.completedTable}_queue_completed_at
        ON ${this.completedTable} (queue, completed_at DESC);
    `);
  }

  async enqueue(job: StoredJob): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${this.table}
        (id, name, payload, queue, state, attempts, max_attempts, idempotency_key, delay_until, scheduled_cron, last_scheduled_at, priority, progress, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      `,
      [
        job.id,
        job.name,
        JSON.stringify(job.payload),
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
      ]
    );
  }

  async dequeue(options: LeaseOptions): Promise<StoredJob[]> {
    const { queue, batchSize, leaseMs } = options;
    const leaseUntil = new Date(Date.now() + leaseMs);

    const queueFilter = queue ? `AND queue = $3` : '';
    const params: (string | number | Date)[] = [batchSize, leaseUntil];
    if (queue) params.push(queue);

    const result = await this.pool.query(
      `
      UPDATE ${this.table}
      SET state       = 'leased',
          lease_until = $2,
          updated_at  = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id IN (
        SELECT id
        FROM ${this.table}
        WHERE (
          (state = 'queued' AND delay_until IS NULL)
          OR (state = 'leased' AND lease_until < NOW())
        )
          ${queueFilter}
        ORDER BY
          CASE priority
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 2
          END ASC,
          created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
      `,
      params
    );

    return result.rows.map((row) => this.rowToJob(row));
  }

  async ack(jobId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = $1`, [jobId]);
  }

  async fail(jobId: string, err: Error): Promise<void> {
    await this.pool.query(
      `
      UPDATE ${this.table}
      SET state      = 'failed',
          updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id = $1
      `,
      [jobId]
    );

    // Persist error message as a notice — non-critical, best effort
    console.error(`[PostgresStore] Job ${jobId} failed: ${err.message}`);
  }

  async moveToDeadLetter(job: StoredJob): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `
        INSERT INTO ${this.dlTable} (id, name, payload, queue, attempts, created_at, failed_at, error_details, retried_at, retried_job_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL)
        ON CONFLICT (id) DO NOTHING
        `,
        [
          job.id,
          job.name,
          JSON.stringify(job.payload),
          job.queue,
          job.attempts,
          job.createdAt,
          Date.now(),
          job.errorDetails ? JSON.stringify(job.errorDetails) : null,
        ]
      );

      await client.query(`DELETE FROM ${this.table} WHERE id = $1`, [job.id]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getQueueDepth(queue: string): Promise<number> {
    const result = await this.pool.query(
      `
      SELECT COUNT(*) AS count
      FROM ${this.table}
      WHERE queue = $1
        AND state IN ('queued', 'leased')
      `,
      [queue]
    );

    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async extendLease(jobId: string, leaseMs: number): Promise<void> {
    const leaseUntil = new Date(Date.now() + leaseMs);

    await this.pool.query(
      `
      UPDATE ${this.table}
      SET lease_until = $2,
          updated_at  = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id = $1
      `,
      [jobId, leaseUntil]
    );
  }

  async updateAttempts(id: string, attempts: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE ${this.table}
      SET attempts   = $2,
          updated_at = EXTRACT(EPOCH FROM NOW()) * 1000
      WHERE id = $1
      `,
      [id, attempts]
    );
  }

  async getDelayedJobs(queueName: string, beforeDate: number): Promise<StoredJob[]> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM ${this.table}
      WHERE queue = $1
        AND state = 'queued'
        AND delay_until IS NOT NULL
        AND delay_until <= $2
      ORDER BY delay_until ASC, created_at ASC
      `,
      [queueName, beforeDate]
    );

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
        ON CONFLICT (id) DO NOTHING
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

      const [jobsResult, dlqResult, completedResult] = await Promise.all([
        client.query(`DELETE FROM ${this.table} WHERE id = $1 AND queue = $2`, [jobId, queueName]),
        client.query(`DELETE FROM ${this.dlTable} WHERE id = $1 AND queue = $2`, [jobId, queueName]),
        client.query(`DELETE FROM ${this.completedTable} WHERE id = $1 AND queue = $2`, [jobId, queueName]),
      ]);

      await client.query('COMMIT');
      return (jobsResult.rowCount ?? 0) + (dlqResult.rowCount ?? 0) + (completedResult.rowCount ?? 0) > 0;
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

      const [jobsResult, dlqResult, completedResult] = await Promise.all([
        client.query(`DELETE FROM ${this.table} WHERE queue = $1`, [queueName]),
        client.query(`DELETE FROM ${this.dlTable} WHERE queue = $1`, [queueName]),
        client.query(`DELETE FROM ${this.completedTable} WHERE queue = $1`, [queueName]),
      ]);

      await client.query('COMMIT');
      return (jobsResult.rowCount ?? 0) + (dlqResult.rowCount ?? 0) + (completedResult.rowCount ?? 0);
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
    const completedAt = Date.now();
    const completedRecord: CompletedJobRecord = {
      ...job,
      state: 'completed',
      updatedAt: completedAt,
      completedAt,
      ...(result !== undefined ? { result } : {}),
    };

    await this.pool.query(
      `
      INSERT INTO ${this.completedTable} (id, queue, completed_at, record)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET queue = EXCLUDED.queue,
          completed_at = EXCLUDED.completed_at,
          record = EXCLUDED.record
      `,
      [job.id, job.queue, completedAt, JSON.stringify(completedRecord)]
    );

    await this.pool.query(
      `
      DELETE FROM ${this.completedTable}
      WHERE id IN (
        SELECT id
        FROM ${this.completedTable}
        WHERE queue = $1
        ORDER BY completed_at DESC
        OFFSET $2
      )
      `,
      [job.queue, this.archiveMaxRowsPerQueue]
    );

    if (this.archiveRetentionMs != null) {
      await this.pool.query(
        `
        DELETE FROM ${this.completedTable}
        WHERE completed_at < $1
        `,
        [Date.now() - this.archiveRetentionMs]
      );
    }
  }

  async getCompletedJobs(query: CompletedJobsQuery): Promise<CompletedJobRecord[]> {
    const values: Array<string | number> = [];
    const conditions: string[] = [];
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
      SELECT record
      FROM ${this.completedTable}
      ${whereClause}
      ORDER BY completed_at DESC
      LIMIT $${index++} OFFSET $${index}
      `,
      values
    );

    return result.rows
      .map((row) => row['record'])
      .filter((record): record is CompletedJobRecord => Boolean(record));
  }

  async queryJobArchive(query: JobArchiveQuery): Promise<CompletedJobRecord[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    let index = 1;

    if (query.queueName) {
      conditions.push(`queue = $${index++}`);
      values.push(query.queueName);
    }

    if (query.jobName) {
      conditions.push(`record->>'name' = $${index++}`);
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
      conditions.push(`record::text ILIKE $${index++}`);
      values.push(`%${query.search}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const result = await this.pool.query(
      `
      SELECT record
      FROM ${this.completedTable}
      ${whereClause}
      ORDER BY completed_at DESC
      LIMIT $${index++} OFFSET $${index}
      `,
      values
    );

    return result.rows
      .map((row) => row['record'])
      .filter((record): record is CompletedJobRecord => Boolean(record));
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
          FROM ${this.completedTable}
          WHERE queue = $1
            AND completed_at <= $2
          LIMIT $3
        )
        DELETE FROM ${this.completedTable}
        WHERE id IN (SELECT id FROM candidates)
        `,
        [queueName, cutoff, limit]
      );
      return result.rowCount ?? 0;
    }

    return 0;
  }
}
