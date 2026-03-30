import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  DynamoDBClientConfig,
  ResourceNotFoundException,
  ScalarAttributeType,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
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
} from '@omni-queue/core';

type JobDoc = StoredJob & {
  priorityRank: number;
  leaseUntil?: number;
};

type DeadLetterDoc = {
  id: string;
  name: string;
  payload: unknown;
  queue: string;
  attempts: number;
  createdAt: number;
  failedAt: number;
};

type CompletedDoc = {
  id: string;
  queue: string;
  completedAt: number;
  record: CompletedJobRecord;
};

export interface DynamoDbStoreConfig {
  client?: DynamoDBDocumentClient | DynamoDBClient;
  clientConfig?: DynamoDBClientConfig;
  region?: string;
  tableName?: string;
  deadLetterTableName?: string;
  completedTableName?: string;
  archiveRetentionMs?: number;
  archiveMaxRowsPerQueue?: number;
}

function getPriorityRank(priority: StoredJob['priority']): number {
  switch (priority) {
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'normal':
      return 2;
    case 'low':
      return 3;
    default:
      return 2;
  }
}

const PRIORITY_BY_RANK: Record<number, 'critical' | 'high' | 'normal' | 'low'> = {
  0: 'critical',
  1: 'high',
  2: 'normal',
  3: 'low',
};

export class DynamoDbStore implements QueueStorage {
  private docClient: DynamoDBDocumentClient;
  private baseClient?: DynamoDBClient;
  private ownsBaseClient: boolean;

  private table: string;
  private dlTable: string;
  private completedTable: string;

  private archiveRetentionMs: number | undefined;
  private archiveMaxRowsPerQueue: number;

  constructor(config: DynamoDbStoreConfig = {}) {
    if (config.client instanceof DynamoDBDocumentClient) {
      this.docClient = config.client;
      this.ownsBaseClient = false;
    } else if (config.client instanceof DynamoDBClient) {
      this.baseClient = config.client;
      this.docClient = DynamoDBDocumentClient.from(config.client);
      this.ownsBaseClient = false;
    } else {
      this.baseClient = new DynamoDBClient({
        region: config.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
        ...(config.clientConfig ?? {}),
      });
      this.docClient = DynamoDBDocumentClient.from(this.baseClient);
      this.ownsBaseClient = true;
    }

    this.table = config.tableName ?? 'omni_queue_jobs';
    this.dlTable = config.deadLetterTableName ?? 'omni_queue_dead_letter';
    this.completedTable = config.completedTableName ?? 'omni_queue_completed';

    this.archiveRetentionMs =
      typeof config.archiveRetentionMs === 'number' &&
      Number.isFinite(config.archiveRetentionMs) &&
      config.archiveRetentionMs > 0
        ? Math.floor(config.archiveRetentionMs)
        : undefined;

    this.archiveMaxRowsPerQueue =
      typeof config.archiveMaxRowsPerQueue === 'number' &&
      Number.isFinite(config.archiveMaxRowsPerQueue) &&
      config.archiveMaxRowsPerQueue > 0
        ? Math.floor(config.archiveMaxRowsPerQueue)
        : 500;
  }

  async migrate(): Promise<void> {
    const base = this.getBaseClient();

    await this.ensureTableExists(base, {
      tableName: this.table,
      keyName: 'id',
      extraAttributes: [
        { name: 'queue', type: ScalarAttributeType.S },
        { name: 'state', type: ScalarAttributeType.S },
        { name: 'createdAt', type: ScalarAttributeType.N },
        { name: 'idempotencyKey', type: ScalarAttributeType.S },
      ],
      globalSecondaryIndexes: [
        {
          IndexName: 'queue-state-createdAt',
          KeySchema: [
            { AttributeName: 'queue', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'idempotencyKey-index',
          KeySchema: [{ AttributeName: 'idempotencyKey', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    });

    await this.ensureTableExists(base, {
      tableName: this.dlTable,
      keyName: 'id',
      extraAttributes: [
        { name: 'queue', type: ScalarAttributeType.S },
        { name: 'failedAt', type: ScalarAttributeType.N },
      ],
      globalSecondaryIndexes: [
        {
          IndexName: 'queue-failedAt',
          KeySchema: [
            { AttributeName: 'queue', KeyType: 'HASH' },
            { AttributeName: 'failedAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    });

    await this.ensureTableExists(base, {
      tableName: this.completedTable,
      keyName: 'id',
      extraAttributes: [
        { name: 'queue', type: ScalarAttributeType.S },
        { name: 'completedAt', type: ScalarAttributeType.N },
      ],
      globalSecondaryIndexes: [
        {
          IndexName: 'queue-completedAt',
          KeySchema: [
            { AttributeName: 'queue', KeyType: 'HASH' },
            { AttributeName: 'completedAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    });
  }

  async enqueue(job: StoredJob): Promise<void> {
    const doc: JobDoc = {
      ...job,
      priorityRank: getPriorityRank(job.priority),
    };

    if (job.idempotencyKey != null) {
      const existing = await this.docClient.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'idempotencyKey-index',
          KeyConditionExpression: 'idempotencyKey = :idempotencyKey',
          ExpressionAttributeValues: {
            ':idempotencyKey': job.idempotencyKey,
          },
          Limit: 1,
        })
      );

      if ((existing.Items?.length ?? 0) > 0) {
        return;
      }
    }

    await this.docClient.send(
      new PutCommand({
        TableName: this.table,
        Item: doc,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    ).catch((error: unknown) => {
      if (this.isConditionalCheckFailure(error)) {
        return;
      }

      throw error;
    });
  }

  async dequeue(options: LeaseOptions): Promise<StoredJob[]> {
    const now = Date.now();
    const leaseUntil = now + options.leaseMs;

    const candidates = await this.listJobCandidatesForDequeue(options.queue, now, Math.max(options.batchSize * 6, 100));
    if (candidates.length === 0) {
      return [];
    }

    const leased: StoredJob[] = [];

    for (const candidate of candidates) {
      if (leased.length >= options.batchSize) {
        break;
      }

      const updated = await this.tryLeaseCandidate(candidate.id, now, leaseUntil);
      if (updated != null) {
        leased.push(updated);
      }
    }

    return leased;
  }

  async ack(jobId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.table,
        Key: { id: jobId },
      })
    );
  }

  async fail(jobId: string, err: Error): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { id: jobId },
        UpdateExpression: 'SET #state = :failed, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':failed': 'failed',
          ':updatedAt': Date.now(),
        },
      })
    );

    console.error(`[DynamoDbStore] Job ${jobId} failed: ${err.message}`);
  }

  async moveToDeadLetter(job: StoredJob): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.dlTable,
        Item: {
          id: job.id,
          name: job.name,
          payload: job.payload,
          queue: job.queue,
          attempts: job.attempts,
          createdAt: job.createdAt,
          failedAt: Date.now(),
        } as DeadLetterDoc,
      })
    );

    await this.docClient.send(
      new DeleteCommand({
        TableName: this.table,
        Key: { id: job.id },
      })
    );
  }

  async getQueueDepth(queue: string): Promise<number> {
    const jobs = await this.scanJobs({
      queue,
      states: ['queued', 'leased'],
    });

    return jobs.length;
  }

  async extendLease(jobId: string, leaseMs: number): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { id: jobId },
        UpdateExpression: 'SET leaseUntil = :leaseUntil, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':leaseUntil': Date.now() + leaseMs,
          ':updatedAt': Date.now(),
        },
      })
    );
  }

  async updateAttempts(id: string, attempts: number): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { id },
        UpdateExpression: 'SET attempts = :attempts, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':attempts': attempts,
          ':updatedAt': Date.now(),
        },
      })
    );
  }

  async getDelayedJobs(queueName: string, beforeDate: number): Promise<StoredJob[]> {
    const jobs = await this.scanJobs({
      queue: queueName,
      states: ['queued'],
      delayedBeforeOrEqual: beforeDate,
    });

    return jobs.sort((left, right) => (left.delayUntil ?? 0) - (right.delayUntil ?? 0) || left.createdAt - right.createdAt);
  }

  async moveJobToQueue(queueName: string, jobId: string, toState: 'active' | 'deferred' | 'failed'): Promise<void> {
    if (toState === 'active') {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { id: jobId },
          ConditionExpression: 'queue = :queue',
          UpdateExpression: 'SET #state = :queued, updatedAt = :updatedAt REMOVE delayUntil',
          ExpressionAttributeNames: {
            '#state': 'state',
          },
          ExpressionAttributeValues: {
            ':queue': queueName,
            ':queued': 'queued',
            ':updatedAt': Date.now(),
          },
        })
      ).catch((error: unknown) => {
        if (this.isConditionalCheckFailure(error)) {
          return;
        }

        throw error;
      });

      return;
    }

    if (toState === 'failed') {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { id: jobId },
          ConditionExpression: 'queue = :queue',
          UpdateExpression: 'SET #state = :failed, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#state': 'state',
          },
          ExpressionAttributeValues: {
            ':queue': queueName,
            ':failed': 'failed',
            ':updatedAt': Date.now(),
          },
        })
      ).catch((error: unknown) => {
        if (this.isConditionalCheckFailure(error)) {
          return;
        }

        throw error;
      });

      return;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { id: jobId },
        ConditionExpression: 'queue = :queue',
        UpdateExpression: 'SET #state = :queued, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':queue': queueName,
          ':queued': 'queued',
          ':updatedAt': Date.now(),
        },
      })
    ).catch((error: unknown) => {
      if (this.isConditionalCheckFailure(error)) {
        return;
      }

      throw error;
    });
  }

  async queryDeferredJobs(query: DeferredJobsQuery): Promise<StoredJob[]> {
    const now = Date.now();
    const scanQuery: {
      queue?: string;
      states?: Array<StoredJob['state']>;
      delayedOnly?: boolean;
      delayedAfter?: number;
      delayedBeforeOrEqual?: number;
    } = {
      delayedOnly: true,
    };

    if (query.queueName) {
      scanQuery.queue = query.queueName;
    }

    if (query.status === 'failed') {
      scanQuery.states = ['failed'];
    }

    if (query.status === 'pending') {
      scanQuery.delayedAfter = now;
    }

    if (query.status === 'promoted') {
      scanQuery.delayedBeforeOrEqual = now;
    }

    const jobs = await this.scanJobs(scanQuery);

    const sorted = jobs.sort(
      (left, right) =>
        (left.delayUntil ?? Number.MAX_SAFE_INTEGER) - (right.delayUntil ?? Number.MAX_SAFE_INTEGER) ||
        left.createdAt - right.createdAt
    );

    return this.paginate(sorted, query.offset, query.limit);
  }

  async setJobProgress(jobId: string, progress: number): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { id: jobId },
        UpdateExpression: 'SET progress = :progress, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':progress': progress,
          ':updatedAt': Date.now(),
        },
      })
    );
  }

  async getDeadLetterJobs(query: DeadLetterQuery): Promise<StoredJob[]> {
    const rows = await this.scanDeadLetter(query.queueName);
    const sorted = rows.sort((left, right) => right.failedAt - left.failedAt);

    return this.paginate(sorted, query.offset, query.limit).map((row) => ({
      id: row.id,
      name: row.name,
      payload: row.payload,
      queue: row.queue,
      state: 'failed',
      attempts: row.attempts,
      createdAt: row.createdAt,
      updatedAt: row.failedAt,
    }));
  }

  async retryDeadLetterJob(queueName: string, jobId: string): Promise<boolean> {
    const deadRow = await this.docClient.send(
      new QueryCommand({
        TableName: this.dlTable,
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: {
          ':id': jobId,
        },
        Limit: 1,
      })
    );

    const item = deadRow.Items?.[0] as DeadLetterDoc | undefined;
    if (!item || item.queue !== queueName) {
      return false;
    }

    const now = Date.now();
    const job: JobDoc = {
      id: item.id,
      name: item.name,
      payload: item.payload,
      queue: item.queue,
      state: 'queued',
      attempts: 0,
      createdAt: item.createdAt,
      updatedAt: now,
      priority: 'normal',
      priorityRank: 2,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.table,
        Item: job,
      })
    );

    await this.docClient.send(
      new DeleteCommand({
        TableName: this.dlTable,
        Key: { id: item.id },
      })
    );

    return true;
  }

  async promoteJob(queueName: string, jobId: string): Promise<boolean> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { id: jobId },
          ConditionExpression: 'queue = :queue AND #state = :queued AND attribute_exists(delayUntil)',
          UpdateExpression: 'SET #state = :queued, updatedAt = :updatedAt REMOVE delayUntil',
          ExpressionAttributeNames: {
            '#state': 'state',
          },
          ExpressionAttributeValues: {
            ':queue': queueName,
            ':queued': 'queued',
            ':updatedAt': Date.now(),
          },
        })
      );
      return true;
    } catch (error: unknown) {
      if (this.isConditionalCheckFailure(error)) {
        return false;
      }
      throw error;
    }
  }

  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    const job = await this.findById<JobDoc>(this.table, jobId);
    if (job && job.queue === queueName) {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { id: jobId },
        })
      );
      return true;
    }

    const dead = await this.findById<DeadLetterDoc>(this.dlTable, jobId);
    if (dead && dead.queue === queueName) {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.dlTable,
          Key: { id: jobId },
        })
      );
      return true;
    }

    const completed = await this.findById<CompletedDoc>(this.completedTable, jobId);
    if (completed && completed.queue === queueName) {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.completedTable,
          Key: { id: jobId },
        })
      );
      return true;
    }

    return false;
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
    const [jobs, deadRows, completedRows] = await Promise.all([
      this.scanJobs({ queue: queueName }),
      this.scanDeadLetter(queueName),
      this.scanCompleted(queueName),
    ]);

    const deletes: Promise<unknown>[] = [];
    for (const job of jobs) {
      deletes.push(
        this.docClient.send(
          new DeleteCommand({
            TableName: this.table,
            Key: { id: job.id },
          })
        )
      );
    }
    for (const row of deadRows) {
      deletes.push(
        this.docClient.send(
          new DeleteCommand({
            TableName: this.dlTable,
            Key: { id: row.id },
          })
        )
      );
    }
    for (const row of completedRows) {
      deletes.push(
        this.docClient.send(
          new DeleteCommand({
            TableName: this.completedTable,
            Key: { id: row.id },
          })
        )
      );
    }

    await Promise.all(deletes);
    return jobs.length + deadRows.length + completedRows.length;
  }

  async getReadyJobs(query: ReadyJobsQuery): Promise<StoredJob[]> {
    const scanQuery: {
      queue?: string;
      states?: Array<StoredJob['state']>;
      onlyWithoutDelay?: boolean;
    } = {
      states: ['queued'],
      onlyWithoutDelay: true,
    };

    if (query.queueName) {
      scanQuery.queue = query.queueName;
    }

    const jobs = await this.scanJobs(scanQuery);

    const sorted = jobs.sort(
      (left, right) => getPriorityRank(left.priority) - getPriorityRank(right.priority) || left.createdAt - right.createdAt
    );
    return this.paginate(sorted, query.offset, query.limit);
  }

  async getActiveJobs(query: ActiveJobsQuery): Promise<StoredJob[]> {
    const scanQuery: {
      queue?: string;
      states?: Array<StoredJob['state']>;
    } = {
      states: ['leased'],
    };

    if (query.queueName) {
      scanQuery.queue = query.queueName;
    }

    const jobs = await this.scanJobs(scanQuery);

    const sorted = jobs.sort((left, right) => left.updatedAt - right.updatedAt || left.createdAt - right.createdAt);
    return this.paginate(sorted, query.offset, query.limit);
  }

  async addCompletedJob(job: StoredJob, result?: unknown): Promise<void> {
    const completedAt = Date.now();
    const record: CompletedJobRecord = {
      ...job,
      state: 'completed',
      updatedAt: completedAt,
      completedAt,
      ...(result !== undefined ? { result } : {}),
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.completedTable,
        Item: {
          id: job.id,
          queue: job.queue,
          completedAt,
          record,
        } as CompletedDoc,
      })
    );

    const byQueue = await this.scanCompleted(job.queue);
    const sorted = byQueue.sort((left, right) => right.completedAt - left.completedAt);
    const stale = sorted.slice(this.archiveMaxRowsPerQueue);

    for (const row of stale) {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.completedTable,
          Key: { id: row.id },
        })
      );
    }

    if (this.archiveRetentionMs != null) {
      const cutoff = Date.now() - this.archiveRetentionMs;
      const oldRows = sorted.filter((row) => row.completedAt < cutoff);
      for (const row of oldRows) {
        await this.docClient.send(
          new DeleteCommand({
            TableName: this.completedTable,
            Key: { id: row.id },
          })
        );
      }
    }
  }

  async getCompletedJobs(query: CompletedJobsQuery): Promise<CompletedJobRecord[]> {
    const rows = await this.scanCompleted(query.queueName);
    const sorted = rows.sort((left, right) => right.completedAt - left.completedAt);
    return this.paginate(sorted, query.offset, query.limit)
      .map((row) => row.record)
      .filter((record): record is CompletedJobRecord => Boolean(record));
  }

  async queryJobArchive(query: JobArchiveQuery): Promise<CompletedJobRecord[]> {
    const rows = await this.scanCompleted(query.queueName);
    const filtered = rows.filter((row) => {
      const record = row.record;

      if (query.jobName && record.name !== query.jobName) {
        return false;
      }

      if (query.fromTs != null && row.completedAt < query.fromTs) {
        return false;
      }

      if (query.toTs != null && row.completedAt > query.toTs) {
        return false;
      }

      if (query.search) {
        const haystack = JSON.stringify(record).toLowerCase();
        if (!haystack.includes(query.search.toLowerCase())) {
          return false;
        }
      }

      return true;
    });

    const sorted = filtered.sort((left, right) => right.completedAt - left.completedAt);
    return this.paginate(sorted, query.offset, query.limit).map((row) => row.record);
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
    if (this.ownsBaseClient && this.baseClient) {
      this.baseClient.destroy();
    }
  }

  private async scanJobs(filters: {
    queue?: string;
    states?: Array<StoredJob['state']>;
    delayedOnly?: boolean;
    onlyWithoutDelay?: boolean;
    delayedAfter?: number;
    delayedBeforeOrEqual?: number;
  }): Promise<StoredJob[]> {
    const rows = await this.scanAll<JobDoc>(this.table);
    return rows
      .filter((row) => {
        if (filters.queue && row.queue !== filters.queue) {
          return false;
        }

        if (filters.states && !filters.states.includes(row.state)) {
          return false;
        }

        if (filters.delayedOnly && row.delayUntil == null) {
          return false;
        }

        if (filters.onlyWithoutDelay && row.delayUntil != null) {
          return false;
        }

        if (filters.delayedAfter != null && (row.delayUntil == null || row.delayUntil <= filters.delayedAfter)) {
          return false;
        }

        if (filters.delayedBeforeOrEqual != null && (row.delayUntil == null || row.delayUntil > filters.delayedBeforeOrEqual)) {
          return false;
        }

        return true;
      })
      .map((row) => this.toStoredJob(row));
  }

  private async scanDeadLetter(queueName?: string): Promise<DeadLetterDoc[]> {
    const rows = await this.scanAll<DeadLetterDoc>(this.dlTable);
    return queueName ? rows.filter((row) => row.queue === queueName) : rows;
  }

  private async scanCompleted(queueName?: string): Promise<CompletedDoc[]> {
    const rows = await this.scanAll<CompletedDoc>(this.completedTable);
    return queueName ? rows.filter((row) => row.queue === queueName) : rows;
  }

  private async scanAll<T>(tableName: string): Promise<T[]> {
    const items: T[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const page = await this.docClient.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (page.Items) {
        items.push(...(page.Items as T[]));
      }

      lastEvaluatedKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items;
  }

  private async cleanByStatus(
    queueName: string,
    status: QueueAdminJobStatus,
    cutoff: number,
    limit: number
  ): Promise<number> {
    if (limit <= 0) return 0;

    if (status === 'ready') {
      const jobs = await this.scanJobs({ queue: queueName, states: ['queued'], onlyWithoutDelay: true });
      const candidates = jobs.filter((job) => (job.updatedAt ?? job.createdAt) <= cutoff).slice(0, limit);
      await Promise.all(
        candidates.map((job) =>
          this.docClient.send(
            new DeleteCommand({
              TableName: this.table,
              Key: { id: job.id },
            })
          )
        )
      );
      return candidates.length;
    }

    if (status === 'active') {
      const jobs = await this.scanJobs({ queue: queueName, states: ['leased'] });
      const candidates = jobs.filter((job) => (job.updatedAt ?? job.createdAt) <= cutoff).slice(0, limit);
      await Promise.all(
        candidates.map((job) =>
          this.docClient.send(
            new DeleteCommand({
              TableName: this.table,
              Key: { id: job.id },
            })
          )
        )
      );
      return candidates.length;
    }

    if (status === 'deferred') {
      const jobs = await this.scanJobs({ queue: queueName, delayedOnly: true });
      const candidates = jobs.filter((job) => (job.updatedAt ?? job.createdAt) <= cutoff).slice(0, limit);
      await Promise.all(
        candidates.map((job) =>
          this.docClient.send(
            new DeleteCommand({
              TableName: this.table,
              Key: { id: job.id },
            })
          )
        )
      );
      return candidates.length;
    }

    if (status === 'failed') {
      const rows = await this.scanDeadLetter(queueName);
      const candidates = rows.filter((row) => row.failedAt <= cutoff).slice(0, limit);
      await Promise.all(
        candidates.map((row) =>
          this.docClient.send(
            new DeleteCommand({
              TableName: this.dlTable,
              Key: { id: row.id },
            })
          )
        )
      );
      return candidates.length;
    }

    if (status === 'completed') {
      const rows = await this.scanCompleted(queueName);
      const candidates = rows.filter((row) => row.completedAt <= cutoff).slice(0, limit);
      await Promise.all(
        candidates.map((row) =>
          this.docClient.send(
            new DeleteCommand({
              TableName: this.completedTable,
              Key: { id: row.id },
            })
          )
        )
      );
      return candidates.length;
    }

    return 0;
  }

  private async findById<T>(tableName: string, id: string): Promise<T | undefined> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: {
          ':id': id,
        },
        Limit: 1,
      })
    );

    return result.Items?.[0] as T | undefined;
  }

  private async listJobCandidatesForDequeue(
    queue: string | undefined,
    now: number,
    limit: number
  ): Promise<Array<{ id: string; priorityRank: number; createdAt: number }>> {
    const all = await this.scanAll<JobDoc>(this.table);
    return all
      .filter((job) => {
        if (queue && job.queue !== queue) {
          return false;
        }

        if (job.state === 'queued') {
          return job.delayUntil == null || job.delayUntil <= now;
        }

        if (job.state === 'leased') {
          return job.leaseUntil != null && job.leaseUntil < now;
        }

        return false;
      })
      .sort((left, right) => left.priorityRank - right.priorityRank || left.createdAt - right.createdAt)
      .slice(0, limit)
      .map((job) => ({ id: job.id, priorityRank: job.priorityRank, createdAt: job.createdAt }));
  }

  private async tryLeaseCandidate(
    jobId: string,
    now: number,
    leaseUntil: number
  ): Promise<StoredJob | null> {
    try {
      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { id: jobId },
          ConditionExpression:
            '(#state = :queued AND (attribute_not_exists(delayUntil) OR delayUntil <= :now)) OR (#state = :leased AND leaseUntil < :now)',
          UpdateExpression: 'SET #state = :leased, leaseUntil = :leaseUntil, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#state': 'state',
          },
          ExpressionAttributeValues: {
            ':queued': 'queued',
            ':leased': 'leased',
            ':now': now,
            ':leaseUntil': leaseUntil,
            ':updatedAt': now,
          },
          ReturnValues: 'ALL_NEW',
        })
      );

      if (!result.Attributes) {
        return null;
      }

      return this.toStoredJob(result.Attributes as JobDoc);
    } catch (error: unknown) {
      if (this.isConditionalCheckFailure(error)) {
        return null;
      }

      throw error;
    }
  }

  private paginate<T>(items: T[], offset = 0, limit = 100): T[] {
    return items.slice(offset, offset + limit);
  }

  private toStoredJob(doc: JobDoc): StoredJob {
    const priority = doc.priority ?? PRIORITY_BY_RANK[doc.priorityRank] ?? 'normal';

    return {
      id: doc.id,
      name: doc.name,
      payload: doc.payload,
      queue: doc.queue,
      state: doc.state,
      attempts: doc.attempts,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      ...(doc.maxAttempts != null ? { maxAttempts: doc.maxAttempts } : {}),
      ...(doc.idempotencyKey != null ? { idempotencyKey: doc.idempotencyKey } : {}),
      ...(doc.delayUntil != null ? { delayUntil: doc.delayUntil } : {}),
      ...(doc.scheduledCron != null ? { scheduledCron: doc.scheduledCron } : {}),
      ...(doc.lastScheduledAt != null ? { lastScheduledAt: doc.lastScheduledAt } : {}),
      ...(priority != null ? { priority } : {}),
      ...(doc.progress != null ? { progress: doc.progress } : {}),
    };
  }

  private getBaseClient(): DynamoDBClient {
    if (this.baseClient) {
      return this.baseClient;
    }

    const candidate = (this.docClient as unknown as { client?: DynamoDBClient }).client;
    if (!candidate) {
      throw new Error('Unable to resolve DynamoDBClient for migration operations');
    }

    this.baseClient = candidate;
    return candidate;
  }

  private async ensureTableExists(
    client: DynamoDBClient,
    options: {
      tableName: string;
      keyName: string;
      extraAttributes?: Array<{ name: string; type: ScalarAttributeType }>;
      globalSecondaryIndexes?: Array<{
        IndexName: string;
        KeySchema: Array<{ AttributeName: string; KeyType: 'HASH' | 'RANGE' }>;
        Projection: { ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE' };
      }>;
    }
  ): Promise<void> {
    const exists = await client
      .send(new DescribeTableCommand({ TableName: options.tableName }))
      .then(() => true)
      .catch((error: unknown) => {
        if (error instanceof ResourceNotFoundException) {
          return false;
        }

        throw error;
      });

    if (exists) {
      return;
    }

    const attrs = [
      { AttributeName: options.keyName, AttributeType: ScalarAttributeType.S },
      ...(options.extraAttributes ?? []).map((attribute) => ({
        AttributeName: attribute.name,
        AttributeType: attribute.type,
      })),
    ];

    const unique = new Map<string, ScalarAttributeType>();
    for (const attribute of attrs) {
      unique.set(attribute.AttributeName, attribute.AttributeType);
    }

    await client.send(
      new CreateTableCommand({
        TableName: options.tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: Array.from(unique.entries()).map(([AttributeName, AttributeType]) => ({
          AttributeName,
          AttributeType,
        })),
        KeySchema: [{ AttributeName: options.keyName, KeyType: 'HASH' }],
        GlobalSecondaryIndexes: options.globalSecondaryIndexes,
      })
    );

    await waitUntilTableExists(
      { client, maxWaitTime: 60 },
      {
        TableName: options.tableName,
      }
    );
  }

  private isConditionalCheckFailure(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      typeof (error as { name?: unknown }).name === 'string' &&
      (error as { name: string }).name === 'ConditionalCheckFailedException'
    );
  }
}
