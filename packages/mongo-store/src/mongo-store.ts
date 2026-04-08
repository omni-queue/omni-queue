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
} from '@vasto-queue/core';
import { MongoClient, MongoClientOptions, Collection, Filter } from 'mongodb';

export interface MongoStoreConfig {
  client: MongoClient | MongoClientOptions;
  uri?: string;
  dbName: string;
  jobsCollectionName?: string;
  deadLetterCollectionName?: string;
  completedCollectionName?: string;
  archiveRetentionMs?: number;
  archiveMaxRowsPerQueue?: number;
}

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
  errorDetails?: StoredJob['errorDetails'];
  retriedAt?: number;
  retriedJobId?: string;
};

type CompletedDoc = {
  id: string;
  queue: string;
  completedAt: number;
  record: CompletedJobRecord;
};

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

function isMongoClient(value: MongoClient | MongoClientOptions): value is MongoClient {
  return typeof (value as Partial<MongoClient>).db === 'function';
}

export class MongoStore implements QueueStorage {
  private client: MongoClient;
  private ownsClient: boolean;
  private dbName: string;
  private jobsCollectionName: string;
  private deadLetterCollectionName: string;
  private completedCollectionName: string;
  private archiveRetentionMs: number | undefined;
  private archiveMaxRowsPerQueue: number;

  private initialized = false;

  constructor(config: MongoStoreConfig) {
    if (isMongoClient(config.client)) {
      this.client = config.client;
      this.ownsClient = false;
    } else {
      this.client = new MongoClient(config.uri ?? 'mongodb://127.0.0.1:27017', config.client);
      this.ownsClient = true;
    }

    this.dbName = config.dbName;
    this.jobsCollectionName = config.jobsCollectionName ?? 'vasto_jobs';
    this.deadLetterCollectionName = config.deadLetterCollectionName ?? 'vasto_dead_letter';
    this.completedCollectionName = config.completedCollectionName ?? 'vasto_completed';
    this.archiveRetentionMs =
      typeof config.archiveRetentionMs === 'number' && Number.isFinite(config.archiveRetentionMs) && config.archiveRetentionMs > 0
        ? Math.floor(config.archiveRetentionMs)
        : undefined;
    this.archiveMaxRowsPerQueue =
      typeof config.archiveMaxRowsPerQueue === 'number' && Number.isFinite(config.archiveMaxRowsPerQueue) && config.archiveMaxRowsPerQueue > 0
        ? Math.floor(config.archiveMaxRowsPerQueue)
        : 500;
  }

  private get jobs(): Collection<JobDoc> {
    return this.client.db(this.dbName).collection<JobDoc>(this.jobsCollectionName);
  }

  private get deadLetters(): Collection<DeadLetterDoc> {
    return this.client.db(this.dbName).collection<DeadLetterDoc>(this.deadLetterCollectionName);
  }

  private get completed(): Collection<CompletedDoc> {
    return this.client.db(this.dbName).collection<CompletedDoc>(this.completedCollectionName);
  }

  async migrate(): Promise<void> {
    await this.ensureInitialized();
    await this.jobs.createIndex({ id: 1 }, { unique: true });
    await this.jobs.createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true });
    await this.jobs.createIndex({ queue: 1, state: 1, priorityRank: 1, createdAt: 1 });
    await this.jobs.createIndex({ queue: 1, delayUntil: 1 });
    await this.jobs.createIndex({ leaseUntil: 1 });

    await this.deadLetters.createIndex({ id: 1 }, { unique: true });
    await this.deadLetters.createIndex({ queue: 1, failedAt: -1 });

    await this.completed.createIndex({ id: 1 }, { unique: true });
    await this.completed.createIndex({ queue: 1, completedAt: -1 });
  }

  async enqueue(job: StoredJob): Promise<void> {
    await this.ensureInitialized();
    const doc: JobDoc = {
      ...job,
      priorityRank: getPriorityRank(job.priority),
    };

    if (job.idempotencyKey != null) {
      await this.jobs.updateOne(
        { idempotencyKey: job.idempotencyKey },
        {
          $setOnInsert: doc,
        },
        { upsert: true }
      );
      return;
    }

    await this.jobs.updateOne({ id: job.id }, { $set: doc }, { upsert: true });
  }

  async dequeue(options: LeaseOptions): Promise<StoredJob[]> {
    await this.ensureInitialized();
    const { queue, batchSize, leaseMs } = options;
    const now = Date.now();
    const leaseUntil = now + leaseMs;
    const jobs: StoredJob[] = [];

    const baseFilter: Filter<JobDoc> = {
      $or: [
        {
          state: 'queued',
          $or: [{ delayUntil: { $exists: false } }, { delayUntil: { $lte: now } }],
        },
        {
          state: 'leased',
          leaseUntil: { $lt: now },
        },
      ],
    };

    if (queue) {
      baseFilter.queue = queue;
    }

    const candidateDocs = await this.jobs
      .find(baseFilter, { projection: { id: 1 } })
      .sort({ priorityRank: 1, createdAt: 1 })
      .limit(Math.max(batchSize * 4, batchSize))
      .toArray();

    for (let index = 0; index < candidateDocs.length; index += 1) {
      if (jobs.length >= batchSize) {
        break;
      }

      const candidate = candidateDocs[index];
      if (!candidate?.id) {
        continue;
      }

      const result = await this.jobs.findOneAndUpdate(
        { ...baseFilter, id: candidate.id },
        {
          $set: {
            state: 'leased',
            leaseUntil,
            updatedAt: now,
          },
        },
        {
          sort: { priorityRank: 1, createdAt: 1 },
          returnDocument: 'after',
        }
      );

      if (!result) {
        break;
      }

      jobs.push(this.toStoredJob(result));
    }

    return jobs;
  }

  async ack(jobId: string): Promise<void> {
    await this.ensureInitialized();
    await this.jobs.deleteOne({ id: jobId });
  }

  async fail(jobId: string, err: Error): Promise<void> {
    await this.ensureInitialized();
    await this.jobs.updateOne(
      { id: jobId },
      {
        $set: {
          state: 'failed',
          updatedAt: Date.now(),
        },
      }
    );

    console.error(`[MongoStore] Job ${jobId} failed: ${err.message}`);
  }

  async moveToDeadLetter(job: StoredJob): Promise<void> {
    await this.ensureInitialized();
    await this.deadLetters.updateOne(
      { id: job.id },
      {
        $setOnInsert: {
          id: job.id,
          name: job.name,
          payload: job.payload,
          queue: job.queue,
          attempts: job.attempts,
          createdAt: job.createdAt,
          failedAt: Date.now(),
          ...(job.errorDetails ? { errorDetails: job.errorDetails } : {}),
        },
      },
      { upsert: true }
    );

    await this.jobs.deleteOne({ id: job.id });
  }

  async getQueueDepth(queue: string): Promise<number> {
    await this.ensureInitialized();
    return this.jobs.countDocuments({
      queue,
      state: { $in: ['queued', 'leased'] },
    });
  }

  async extendLease(jobId: string, leaseMs: number): Promise<void> {
    await this.ensureInitialized();
    await this.jobs.updateOne(
      { id: jobId },
      {
        $set: {
          leaseUntil: Date.now() + leaseMs,
          updatedAt: Date.now(),
        },
      }
    );
  }

  async updateAttempts(id: string, attempts: number): Promise<void> {
    await this.ensureInitialized();
    await this.jobs.updateOne(
      { id },
      {
        $set: {
          attempts,
          updatedAt: Date.now(),
        },
      }
    );
  }

  async getDelayedJobs(queueName: string, beforeDate: number): Promise<StoredJob[]> {
    await this.ensureInitialized();
    const rows = await this.jobs
      .find({
        queue: queueName,
        state: 'queued',
        delayUntil: { $exists: true, $lte: beforeDate },
      })
      .sort({ delayUntil: 1, createdAt: 1 })
      .toArray();

    return rows.map((row) => this.toStoredJob(row));
  }

  async moveJobToQueue(queueName: string, jobId: string, toState: 'active' | 'deferred' | 'failed'): Promise<void> {
    if (toState === 'active') {
      await this.jobs.updateOne(
        { id: jobId, queue: queueName },
        {
          $set: {
            state: 'queued',
            updatedAt: Date.now(),
          },
          $unset: { delayUntil: '' },
        }
      );
      return;
    }

    if (toState === 'failed') {
      await this.jobs.updateOne(
        { id: jobId, queue: queueName },
        {
          $set: {
            state: 'failed',
            updatedAt: Date.now(),
          },
        }
      );
      return;
    }

    await this.jobs.updateOne(
      { id: jobId, queue: queueName },
      {
        $set: {
          state: 'queued',
          updatedAt: Date.now(),
        },
      }
    );
  }

  async queryDeferredJobs(query: DeferredJobsQuery): Promise<StoredJob[]> {
    await this.ensureInitialized();
    const now = Date.now();
    const filter: Filter<JobDoc> = {
      delayUntil: { $exists: true },
    };

    if (query.queueName) {
      filter.queue = query.queueName;
    }

    if (query.status === 'pending') {
      filter.state = 'queued';
      filter.delayUntil = { $gt: now };
    } else if (query.status === 'failed') {
      filter.state = 'failed';
    } else if (query.status === 'promoted') {
      filter.state = 'queued';
      filter.delayUntil = { $lte: now };
    }

    const rows = await this.jobs
      .find(filter)
      .sort({ delayUntil: 1, createdAt: 1 })
      .skip(query.offset ?? 0)
      .limit(query.limit ?? 100)
      .toArray();

    return rows.map((row) => this.toStoredJob(row));
  }

  async setJobProgress(jobId: string, progress: number): Promise<void> {
    await this.ensureInitialized();
    await this.jobs.updateOne(
      { id: jobId },
      {
        $set: {
          progress,
          updatedAt: Date.now(),
        },
      }
    );
  }

  async getDeadLetterJobs(query: DeadLetterQuery): Promise<StoredJob[]> {
    await this.ensureInitialized();
    const filter: Filter<DeadLetterDoc> = {};
    if (query.queueName) {
      filter.queue = query.queueName;
    }

    const rows = await this.deadLetters
      .find(filter)
      .sort({ failedAt: -1 })
      .skip(query.offset ?? 0)
      .limit(query.limit ?? 100)
      .toArray();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      payload: row.payload,
      queue: row.queue,
      state: 'failed',
      attempts: row.attempts,
      createdAt: row.createdAt,
      updatedAt: row.failedAt,
      ...(row.errorDetails ? { errorDetails: row.errorDetails } : {}),
      ...(row.retriedAt != null ? { retriedAt: row.retriedAt } : {}),
      ...(row.retriedJobId ? { retriedJobId: row.retriedJobId } : {}),
    }));
  }

  async retryDeadLetterJob(queueName: string, jobId: string): Promise<boolean> {
    await this.ensureInitialized();
    const now = Date.now();
    const retriedJobId = crypto.randomUUID();

    const deadRow = await this.deadLetters.findOneAndUpdate(
      {
        id: jobId,
        queue: queueName,
        retriedAt: { $exists: false },
      },
      {
        $set: {
          retriedAt: now,
          retriedJobId,
          failedAt: now,
        },
      },
      {
        returnDocument: 'before',
      }
    );

    if (!deadRow) {
      return false;
    }

    await this.jobs.updateOne(
      { id: retriedJobId },
      {
        $setOnInsert: {
          id: retriedJobId,
          name: deadRow.name,
          payload: deadRow.payload,
          queue: deadRow.queue,
          state: 'queued',
          attempts: 0,
          priority: 'normal',
          priorityRank: 2,
          createdAt: now,
          updatedAt: now,
        } as JobDoc,
      },
      { upsert: true }
    );

    return true;
  }

  async promoteJob(queueName: string, jobId: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.jobs.updateOne(
      { id: jobId, queue: queueName, state: 'queued', delayUntil: { $exists: true } },
      {
        $set: {
          state: 'queued',
          updatedAt: Date.now(),
        },
        $unset: { delayUntil: '' },
      }
    );

    return result.modifiedCount > 0;
  }

  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    await this.ensureInitialized();

    const jobsResult = await this.jobs.deleteOne({ id: jobId, queue: queueName });
    if (jobsResult.deletedCount > 0) return true;

    const deadResult = await this.deadLetters.deleteOne({ id: jobId, queue: queueName });
    if (deadResult.deletedCount > 0) return true;

    const completedResult = await this.completed.deleteOne({ id: jobId, queue: queueName });
    return completedResult.deletedCount > 0;
  }

  async cleanJobs(queueName: string, options: QueueCleanOptions = {}): Promise<number> {
    await this.ensureInitialized();

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
    await this.ensureInitialized();

    const [jobsResult, deadResult, completedResult] = await Promise.all([
      this.jobs.deleteMany({ queue: queueName }),
      this.deadLetters.deleteMany({ queue: queueName }),
      this.completed.deleteMany({ queue: queueName }),
    ]);

    return jobsResult.deletedCount + deadResult.deletedCount + completedResult.deletedCount;
  }

  async getReadyJobs(query: ReadyJobsQuery): Promise<StoredJob[]> {
    await this.ensureInitialized();
    const filter: Filter<JobDoc> = {
      state: 'queued',
      delayUntil: { $exists: false },
    };

    if (query.queueName) {
      filter.queue = query.queueName;
    }

    const rows = await this.jobs
      .find(filter)
      .sort({ priorityRank: 1, createdAt: 1 })
      .skip(query.offset ?? 0)
      .limit(query.limit ?? 100)
      .toArray();

    return rows.map((row) => this.toStoredJob(row));
  }

  async getActiveJobs(query: ActiveJobsQuery): Promise<StoredJob[]> {
    await this.ensureInitialized();
    const filter: Filter<JobDoc> = {
      state: 'leased',
    };

    if (query.queueName) {
      filter.queue = query.queueName;
    }

    const rows = await this.jobs
      .find(filter)
      .sort({ updatedAt: 1, createdAt: 1 })
      .skip(query.offset ?? 0)
      .limit(query.limit ?? 100)
      .toArray();

    return rows.map((row) => this.toStoredJob(row));
  }

  async addCompletedJob(job: StoredJob, result?: unknown): Promise<void> {
    await this.ensureInitialized();
    const completedAt = Date.now();
    const record: CompletedJobRecord = {
      ...job,
      state: 'completed',
      updatedAt: completedAt,
      completedAt,
      ...(result !== undefined ? { result } : {}),
    };

    await this.completed.updateOne(
      { id: job.id },
      {
        $set: {
          id: job.id,
          queue: job.queue,
          completedAt,
          record,
        },
      },
      { upsert: true }
    );

    const stale = await this.completed
      .find({ queue: job.queue })
      .sort({ completedAt: -1 })
      .skip(this.archiveMaxRowsPerQueue)
      .project<{ id: string }>({ id: 1, _id: 0 })
      .toArray();

    if (stale.length > 0) {
      await this.completed.deleteMany({ id: { $in: stale.map((row) => row.id) } });
    }

    if (this.archiveRetentionMs != null) {
      await this.completed.deleteMany({
        completedAt: { $lt: Date.now() - this.archiveRetentionMs },
      });
    }
  }

  async getCompletedJobs(query: CompletedJobsQuery): Promise<CompletedJobRecord[]> {
    await this.ensureInitialized();
    const filter: Filter<CompletedDoc> = {};
    if (query.queueName) {
      filter.queue = query.queueName;
    }

    const rows = await this.completed
      .find(filter)
      .sort({ completedAt: -1 })
      .skip(query.offset ?? 0)
      .limit(query.limit ?? 100)
      .toArray();

    return rows.map((row) => row.record).filter((record): record is CompletedJobRecord => Boolean(record));
  }

  async queryJobArchive(query: JobArchiveQuery): Promise<CompletedJobRecord[]> {
    await this.ensureInitialized();

    const filter: Filter<CompletedDoc> = {};
    if (query.queueName) {
      filter.queue = query.queueName;
    }
    if (query.jobName) {
      filter['record.name'] = query.jobName;
    }
    if (query.fromTs != null || query.toTs != null) {
      filter.completedAt = {
        ...(query.fromTs != null ? { $gte: query.fromTs } : {}),
        ...(query.toTs != null ? { $lte: query.toTs } : {}),
      };
    }

    const rows = await this.completed.find(filter).sort({ completedAt: -1 }).toArray();

    const search = query.search?.toLowerCase();
    const filtered = search
      ? rows.filter((row) => JSON.stringify(row.record).toLowerCase().includes(search))
      : rows;

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    return filtered.slice(offset, offset + limit).map((row) => row.record);
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
    if (this.ownsClient) {
      await this.client.close();
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.client.connect();
      this.initialized = true;
    }
  }

  private toStoredJob(doc: JobDoc): StoredJob {
    const job: StoredJob = {
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
      ...(doc.priority != null ? { priority: doc.priority } : {}),
      ...(doc.progress != null ? { progress: doc.progress } : {}),
    };

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
      return this.deleteWithLimit(
        this.jobs,
        {
          queue: queueName,
          state: 'queued',
          delayUntil: { $exists: false },
          updatedAt: { $lte: cutoff },
        },
        limit
      );
    }

    if (status === 'active') {
      return this.deleteWithLimit(
        this.jobs,
        {
          queue: queueName,
          state: 'leased',
          updatedAt: { $lte: cutoff },
        },
        limit
      );
    }

    if (status === 'deferred') {
      return this.deleteWithLimit(
        this.jobs,
        {
          queue: queueName,
          delayUntil: { $exists: true },
          updatedAt: { $lte: cutoff },
        },
        limit
      );
    }

    if (status === 'failed') {
      return this.deleteWithLimit(
        this.deadLetters,
        {
          queue: queueName,
          failedAt: { $lte: cutoff },
        },
        limit
      );
    }

    if (status === 'completed') {
      return this.deleteWithLimit(
        this.completed,
        {
          queue: queueName,
          completedAt: { $lte: cutoff },
        },
        limit
      );
    }

    return 0;
  }

  private async deleteWithLimit<T extends { id: string }>(
    collection: Collection<T>,
    filter: Filter<T>,
    limit: number
  ): Promise<number> {
    if (limit <= 0) return 0;

    const rows = await collection.find(filter).project<{ id: string }>({ id: 1, _id: 0 }).limit(limit).toArray();
    const ids = rows.map((row) => row.id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return 0;

    const result = await collection.deleteMany({ id: { $in: ids } } as Filter<T>);
    return result.deletedCount;
  }
}
