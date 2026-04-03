import type {
  ActiveJobsQuery,
  ArchiveRetentionPolicy,
  CompletedJobRecord,
  CompletedJobsQuery,
  DeadLetterQuery,
  DeferredJobsQuery,
  JobArchiveQuery,
  LeaseOptions,
  QueueAdminJobStatus,
  QueueCleanOptions,
  QueueStorage,
  ReadyJobsQuery,
  StoredJob,
} from '@vasto/core';
import { Pool, PoolOptions, RowDataPacket, createPool } from 'mysql2/promise';

export interface MySqlStoreConfig {
  pool: Pool | PoolOptions;
  tableName?: string;
  deadLetterTableName?: string;
  completedTableName?: string;
  archiveRetentionMs?: number;
  archiveMaxRowsPerQueue?: number;
}

type DbRow = RowDataPacket & Record<string, unknown>;

function isPool(value: Pool | PoolOptions): value is Pool {
  return typeof (value as Partial<Pool>).getConnection === 'function';
}

export class MySqlStore implements QueueStorage {
  private pool: Pool;
  private table: string;
  private dlTable: string;
  private completedTable: string;
  private archiveRetentionMs: number | undefined;
  private archiveMaxRowsPerQueue: number;

  constructor(config: MySqlStoreConfig) {
    this.pool = isPool(config.pool) ? config.pool : createPool(config.pool);
    this.table = config.tableName ?? 'vasto_jobs';
    this.dlTable = config.deadLetterTableName ?? 'vasto_dead_letter';
    this.completedTable = config.completedTableName ?? 'vasto_completed';
    this.archiveRetentionMs =
      typeof config.archiveRetentionMs === 'number' && Number.isFinite(config.archiveRetentionMs) && config.archiveRetentionMs > 0
        ? Math.floor(config.archiveRetentionMs)
        : undefined;
    this.archiveMaxRowsPerQueue =
      typeof config.archiveMaxRowsPerQueue === 'number' && Number.isFinite(config.archiveMaxRowsPerQueue) && config.archiveMaxRowsPerQueue > 0
        ? Math.floor(config.archiveMaxRowsPerQueue)
        : 500;
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id                VARCHAR(191) PRIMARY KEY,
        name              VARCHAR(255) NOT NULL,
        payload           JSON NOT NULL,
        queue             VARCHAR(191) NOT NULL,
        state             VARCHAR(32) NOT NULL DEFAULT 'queued',
        attempts          INT NOT NULL DEFAULT 0,
        max_attempts      INT NULL,
        idempotency_key   VARCHAR(191) NULL,
        delay_until       BIGINT NULL,
        scheduled_cron    VARCHAR(191) NULL,
        last_scheduled_at BIGINT NULL,
        priority          VARCHAR(32) NOT NULL DEFAULT 'normal',
        progress          INT NULL,
        lease_until       BIGINT NULL,
        created_at        BIGINT NOT NULL,
        updated_at        BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await this.pool.query(`CREATE INDEX idx_${this.table}_queue_state ON ${this.table} (queue, state, created_at)`).catch(() => undefined);
    await this.pool.query(`CREATE INDEX idx_${this.table}_queue_priority ON ${this.table} (queue, state, priority, created_at)`).catch(() => undefined);
    await this.pool.query(`CREATE INDEX idx_${this.table}_queue_delay ON ${this.table} (queue, delay_until)`).catch(() => undefined);
    await this.pool.query(`CREATE UNIQUE INDEX idx_${this.table}_idempotency ON ${this.table} (idempotency_key)`).catch(() => undefined);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.dlTable} (
        id          VARCHAR(191) PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        payload     JSON NOT NULL,
        queue       VARCHAR(191) NOT NULL,
        attempts    INT NOT NULL DEFAULT 0,
        created_at  BIGINT NOT NULL,
        failed_at   BIGINT NOT NULL,
        error_details JSON NULL,
        retried_at BIGINT NULL,
        retried_job_id VARCHAR(191) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await this.pool
      .query(`ALTER TABLE ${this.dlTable} ADD COLUMN IF NOT EXISTS error_details JSON NULL`)
      .catch(() => undefined);
    await this.pool
      .query(`ALTER TABLE ${this.dlTable} ADD COLUMN IF NOT EXISTS retried_at BIGINT NULL`)
      .catch(() => undefined);
    await this.pool
      .query(`ALTER TABLE ${this.dlTable} ADD COLUMN IF NOT EXISTS retried_job_id VARCHAR(191) NULL`)
      .catch(() => undefined);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.completedTable} (
        id           VARCHAR(191) PRIMARY KEY,
        queue        VARCHAR(191) NOT NULL,
        completed_at BIGINT NOT NULL,
        record       JSON NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await this.pool
      .query(`CREATE INDEX idx_${this.completedTable}_queue_completed_at ON ${this.completedTable} (queue, completed_at)`)
      .catch(() => undefined);
  }

  async enqueue(job: StoredJob): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${this.table}
        (id, name, payload, queue, state, attempts, max_attempts, idempotency_key, delay_until, scheduled_cron, last_scheduled_at, priority, progress, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        id = IF(idempotency_key IS NOT NULL, id, VALUES(id))
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
    const conn = await this.pool.getConnection();
    const leaseUntil = Date.now() + leaseMs;
    const now = Date.now();

    try {
      await conn.beginTransaction();

      const queueCondition = queue ? 'AND queue = ?' : '';
      const params: Array<string | number> = [now, now];
      if (queue) params.push(queue);
      params.push(batchSize);

      const [rows] = await conn.query<DbRow[]>(
        `
        SELECT *
        FROM ${this.table}
        WHERE (
          (state = 'queued' AND (delay_until IS NULL OR delay_until <= ?))
          OR (state = 'leased' AND lease_until IS NOT NULL AND lease_until < ?)
        )
        ${queueCondition}
        ORDER BY
          CASE priority
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 2
          END ASC,
          created_at ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED
        `,
        params
      );

      if (rows.length === 0) {
        await conn.commit();
        return [];
      }

      const ids = rows.map((row) => String(row['id']));
      const placeholders = ids.map(() => '?').join(', ');
      await conn.query(
        `
        UPDATE ${this.table}
        SET state = 'leased',
            lease_until = ?,
            updated_at = ?
        WHERE id IN (${placeholders})
        `,
        [leaseUntil, now, ...ids]
      );

      await conn.commit();
      return rows.map((row) => this.rowToJob(row));
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async ack(jobId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = ?`, [jobId]);
  }

  async fail(jobId: string, err: Error): Promise<void> {
    await this.pool.query(
      `
      UPDATE ${this.table}
      SET state = 'failed',
          updated_at = ?
      WHERE id = ?
      `,
      [Date.now(), jobId]
    );

    console.error(`[MySqlStore] Job ${jobId} failed: ${err.message}`);
  }

  async moveToDeadLetter(job: StoredJob): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `
        INSERT INTO ${this.dlTable} (id, name, payload, queue, attempts, created_at, failed_at, error_details, retried_at, retried_job_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        ON DUPLICATE KEY UPDATE id = id
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

      await conn.query(`DELETE FROM ${this.table} WHERE id = ?`, [job.id]);
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async getQueueDepth(queue: string): Promise<number> {
    const [rows] = await this.pool.query<DbRow[]>(
      `
      SELECT COUNT(*) AS count
      FROM ${this.table}
      WHERE queue = ?
        AND state IN ('queued', 'leased')
      `,
      [queue]
    );

    return Number(rows[0]?.['count'] ?? 0);
  }

  async extendLease(jobId: string, leaseMs: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE ${this.table}
      SET lease_until = ?,
          updated_at = ?
      WHERE id = ?
      `,
      [Date.now() + leaseMs, Date.now(), jobId]
    );
  }

  async updateAttempts(id: string, attempts: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE ${this.table}
      SET attempts = ?,
          updated_at = ?
      WHERE id = ?
      `,
      [attempts, Date.now(), id]
    );
  }

  async getDelayedJobs(queueName: string, beforeDate: number): Promise<StoredJob[]> {
    const [rows] = await this.pool.query<DbRow[]>(
      `
      SELECT *
      FROM ${this.table}
      WHERE queue = ?
        AND state = 'queued'
        AND delay_until IS NOT NULL
        AND delay_until <= ?
      ORDER BY delay_until ASC, created_at ASC
      `,
      [queueName, beforeDate]
    );

    return rows.map((row) => this.rowToJob(row));
  }

  moveJobToQueue(queueName: string, jobId: string, toState: 'active' | 'deferred' | 'failed'): Promise<void> {
    if (toState === 'active') {
      return this.pool
        .query(
          `
          UPDATE ${this.table}
          SET state = 'queued',
              delay_until = NULL,
              updated_at = ?
          WHERE id = ? AND queue = ?
          `,
          [Date.now(), jobId, queueName]
        )
        .then(() => undefined);
    }

    if (toState === 'failed') {
      return this.pool
        .query(
          `
          UPDATE ${this.table}
          SET state = 'failed',
              updated_at = ?
          WHERE id = ? AND queue = ?
          `,
          [Date.now(), jobId, queueName]
        )
        .then(() => undefined);
    }

    return this.pool
      .query(
        `
        UPDATE ${this.table}
        SET state = 'queued',
            updated_at = ?
        WHERE id = ? AND queue = ?
        `,
        [Date.now(), jobId, queueName]
      )
      .then(() => undefined);
  }

  async queryDeferredJobs(query: DeferredJobsQuery): Promise<StoredJob[]> {
    const conditions: string[] = ['delay_until IS NOT NULL'];
    const values: Array<string | number> = [];

    if (query.queueName) {
      conditions.push('queue = ?');
      values.push(query.queueName);
    }

    if (query.status === 'pending') {
      conditions.push(`state = 'queued'`);
      conditions.push(`delay_until > ?`);
      values.push(Date.now());
    } else if (query.status === 'failed') {
      conditions.push(`state = 'failed'`);
    } else if (query.status === 'promoted') {
      conditions.push(`state = 'queued'`);
      conditions.push(`delay_until <= ?`);
      values.push(Date.now());
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const [rows] = await this.pool.query<DbRow[]>(
      `
      SELECT *
      FROM ${this.table}
      WHERE ${conditions.join(' AND ')}
      ORDER BY delay_until ASC, created_at ASC
      LIMIT ? OFFSET ?
      `,
      values
    );

    return rows.map((row) => this.rowToJob(row));
  }

  async setJobProgress(jobId: string, progress: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE ${this.table}
      SET progress = ?,
          updated_at = ?
      WHERE id = ?
      `,
      [progress, Date.now(), jobId]
    );
  }

  async getDeadLetterJobs(query: DeadLetterQuery): Promise<StoredJob[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];

    if (query.queueName) {
      conditions.push('queue = ?');
      values.push(query.queueName);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const [rows] = await this.pool.query<DbRow[]>(
      `
      SELECT *
      FROM ${this.dlTable}
      ${whereClause}
      ORDER BY failed_at DESC
      LIMIT ? OFFSET ?
      `,
      values
    );

    return rows.map((row) => {
      const errorDetails = this.fromJsonColumn(row['error_details']);

      return {
        id: String(row['id']),
        name: String(row['name']),
        payload: this.fromJsonColumn(row['payload']),
        queue: String(row['queue']),
        state: 'failed',
        attempts: Number(row['attempts'] ?? 0),
        createdAt: Number(row['created_at']),
        updatedAt: Number(row['failed_at']),
        ...(errorDetails != null
          ? { errorDetails: errorDetails as NonNullable<StoredJob['errorDetails']> }
          : {}),
        ...(row['retried_at'] != null ? { retriedAt: Number(row['retried_at']) } : {}),
        ...(row['retried_job_id'] != null ? { retriedJobId: String(row['retried_job_id']) } : {}),
      };
    });
  }

  async retryDeadLetterJob(queueName: string, jobId: string): Promise<boolean> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [deadRows] = await conn.query<DbRow[]>(
        `SELECT * FROM ${this.dlTable} WHERE id = ? AND queue = ? AND retried_at IS NULL LIMIT 1 FOR UPDATE`,
        [jobId, queueName]
      );

      const row = deadRows[0];
      if (!row) {
        await conn.rollback();
        return false;
      }

      const now = Date.now();
      const retriedJobId = crypto.randomUUID();
      await conn.query(
        `
        INSERT INTO ${this.table}
          (id, name, payload, queue, state, attempts, max_attempts, idempotency_key, delay_until, scheduled_cron, last_scheduled_at, priority, progress, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, NULL, 'normal', NULL, ?, ?)
        ON DUPLICATE KEY UPDATE id = id
        `,
        [retriedJobId, row['name'], row['payload'], row['queue'], now, now]
      );

      await conn.query(
        `UPDATE ${this.dlTable} SET retried_at = ?, retried_job_id = ?, failed_at = ? WHERE id = ? AND queue = ?`,
        [now, retriedJobId, now, jobId, queueName]
      );
      await conn.commit();
      return true;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async promoteJob(queueName: string, jobId: string): Promise<boolean> {
    const [result] = await this.pool.query(
      `
      UPDATE ${this.table}
      SET state = 'queued',
          delay_until = NULL,
          updated_at = ?
      WHERE id = ?
        AND queue = ?
        AND state = 'queued'
        AND delay_until IS NOT NULL
      `,
      [Date.now(), jobId, queueName]
    );

    return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [jobsResult] = await conn.query(`DELETE FROM ${this.table} WHERE id = ? AND queue = ?`, [jobId, queueName]);
      const [dlqResult] = await conn.query(`DELETE FROM ${this.dlTable} WHERE id = ? AND queue = ?`, [jobId, queueName]);
      const [completedResult] = await conn.query(
        `DELETE FROM ${this.completedTable} WHERE id = ? AND queue = ?`,
        [jobId, queueName]
      );

      await conn.commit();

      return (
        Number((jobsResult as { affectedRows?: number }).affectedRows ?? 0) +
        Number((dlqResult as { affectedRows?: number }).affectedRows ?? 0) +
        Number((completedResult as { affectedRows?: number }).affectedRows ?? 0)
      ) > 0;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
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
      removed += await this.cleanByStatus(queueName, currentStatus, cutoff, limit - removed);
    }

    return removed;
  }

  async obliterateQueue(queueName: string): Promise<number> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [jobsResult] = await conn.query(`DELETE FROM ${this.table} WHERE queue = ?`, [queueName]);
      const [dlqResult] = await conn.query(`DELETE FROM ${this.dlTable} WHERE queue = ?`, [queueName]);
      const [completedResult] = await conn.query(`DELETE FROM ${this.completedTable} WHERE queue = ?`, [queueName]);

      await conn.commit();

      return (
        Number((jobsResult as { affectedRows?: number }).affectedRows ?? 0) +
        Number((dlqResult as { affectedRows?: number }).affectedRows ?? 0) +
        Number((completedResult as { affectedRows?: number }).affectedRows ?? 0)
      );
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async getReadyJobs(query: ReadyJobsQuery): Promise<StoredJob[]> {
    const values: Array<string | number> = [];
    const conditions: string[] = ["state = 'queued'", 'delay_until IS NULL'];

    if (query.queueName) {
      conditions.push('queue = ?');
      values.push(query.queueName);
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const [rows] = await this.pool.query<DbRow[]>(
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
      LIMIT ? OFFSET ?
      `,
      values
    );

    return rows.map((row) => this.rowToJob(row));
  }

  async getActiveJobs(query: ActiveJobsQuery): Promise<StoredJob[]> {
    const values: Array<string | number> = [];
    const conditions: string[] = ["state = 'leased'"];

    if (query.queueName) {
      conditions.push('queue = ?');
      values.push(query.queueName);
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const [rows] = await this.pool.query<DbRow[]>(
      `
      SELECT *
      FROM ${this.table}
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at ASC, created_at ASC
      LIMIT ? OFFSET ?
      `,
      values
    );

    return rows.map((row) => this.rowToJob(row));
  }

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
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        queue = VALUES(queue),
        completed_at = VALUES(completed_at),
        record = VALUES(record)
      `,
      [job.id, job.queue, completedAt, JSON.stringify(completedRecord)]
    );

    await this.pool.query(
      `
      DELETE c
      FROM ${this.completedTable} c
      JOIN (
        SELECT id
        FROM ${this.completedTable}
        WHERE queue = ?
        ORDER BY completed_at DESC
        LIMIT 18446744073709551615 OFFSET ?
      ) old ON old.id = c.id
      `,
      [job.queue, this.archiveMaxRowsPerQueue]
    );

    if (this.archiveRetentionMs != null) {
      await this.pool.query(
        `
        DELETE FROM ${this.completedTable}
        WHERE completed_at < ?
        `,
        [Date.now() - this.archiveRetentionMs]
      );
    }
  }

  async getCompletedJobs(query: CompletedJobsQuery): Promise<CompletedJobRecord[]> {
    const values: Array<string | number> = [];
    const conditions: string[] = [];

    if (query.queueName) {
      conditions.push('queue = ?');
      values.push(query.queueName);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const [rows] = await this.pool.query<DbRow[]>(
      `
      SELECT record
      FROM ${this.completedTable}
      ${whereClause}
      ORDER BY completed_at DESC
      LIMIT ? OFFSET ?
      `,
      values
    );

    return rows
      .map((row) => this.fromJsonColumn(row['record']) as CompletedJobRecord | null)
      .filter((record): record is CompletedJobRecord => Boolean(record));
  }

  async queryJobArchive(query: JobArchiveQuery): Promise<CompletedJobRecord[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];

    if (query.queueName) {
      conditions.push('queue = ?');
      values.push(query.queueName);
    }

    if (query.jobName) {
      conditions.push(`JSON_UNQUOTE(JSON_EXTRACT(record, '$.name')) = ?`);
      values.push(query.jobName);
    }

    if (query.fromTs != null) {
      conditions.push('completed_at >= ?');
      values.push(query.fromTs);
    }

    if (query.toTs != null) {
      conditions.push('completed_at <= ?');
      values.push(query.toTs);
    }

    if (query.search) {
      conditions.push('CAST(record AS CHAR) LIKE ?');
      values.push(`%${query.search}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    values.push(limit, offset);

    const [rows] = await this.pool.query<DbRow[]>(
      `
      SELECT record
      FROM ${this.completedTable}
      ${whereClause}
      ORDER BY completed_at DESC
      LIMIT ? OFFSET ?
      `,
      values
    );

    return rows
      .map((row) => this.fromJsonColumn(row['record']) as CompletedJobRecord | null)
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

  async close(): Promise<void> {
    await this.pool.end();
  }

  private rowToJob(row: DbRow): StoredJob {
    const job: StoredJob = {
      id: String(row['id']),
      name: String(row['name']),
      payload: this.fromJsonColumn(row['payload']),
      queue: String(row['queue']),
      state: row['state'] as StoredJob['state'],
      attempts: Number(row['attempts'] ?? 0),
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };

    if (row['max_attempts'] != null) {
      job.maxAttempts = Number(row['max_attempts']);
    }

    if (row['idempotency_key'] != null) {
      job.idempotencyKey = String(row['idempotency_key']);
    }

    if (row['delay_until'] != null) {
      job.delayUntil = Number(row['delay_until']);
    }

    if (row['scheduled_cron'] != null) {
      job.scheduledCron = String(row['scheduled_cron']);
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

  private fromJsonColumn(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  private async cleanByStatus(
    queueName: string,
    status: QueueAdminJobStatus,
    cutoff: number,
    limit: number
  ): Promise<number> {
    if (limit <= 0) return 0;

    if (status === 'ready') {
      const [result] = await this.pool.query(
        `
        DELETE FROM ${this.table}
        WHERE queue = ?
          AND state = 'queued'
          AND delay_until IS NULL
          AND updated_at <= ?
        LIMIT ?
        `,
        [queueName, cutoff, limit]
      );
      return Number((result as { affectedRows?: number }).affectedRows ?? 0);
    }

    if (status === 'active') {
      const [result] = await this.pool.query(
        `
        DELETE FROM ${this.table}
        WHERE queue = ?
          AND state = 'leased'
          AND updated_at <= ?
        LIMIT ?
        `,
        [queueName, cutoff, limit]
      );
      return Number((result as { affectedRows?: number }).affectedRows ?? 0);
    }

    if (status === 'deferred') {
      const [result] = await this.pool.query(
        `
        DELETE FROM ${this.table}
        WHERE queue = ?
          AND delay_until IS NOT NULL
          AND updated_at <= ?
        LIMIT ?
        `,
        [queueName, cutoff, limit]
      );
      return Number((result as { affectedRows?: number }).affectedRows ?? 0);
    }

    if (status === 'failed') {
      const [result] = await this.pool.query(
        `
        DELETE FROM ${this.dlTable}
        WHERE queue = ?
          AND failed_at <= ?
        LIMIT ?
        `,
        [queueName, cutoff, limit]
      );
      return Number((result as { affectedRows?: number }).affectedRows ?? 0);
    }

    if (status === 'completed') {
      const [result] = await this.pool.query(
        `
        DELETE FROM ${this.completedTable}
        WHERE queue = ?
          AND completed_at <= ?
        LIMIT ?
        `,
        [queueName, cutoff, limit]
      );
      return Number((result as { affectedRows?: number }).affectedRows ?? 0);
    }

    return 0;
  }
}
