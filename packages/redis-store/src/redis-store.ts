import Redis, { RedisOptions } from 'ioredis';
import type {
  ActiveJobsQuery,
  CompletedJobRecord,
  CompletedJobsQuery,
  JobPriority,
  LeaseOptions,
  QueueAdminJobStatus,
  QueueCleanOptions,
  QueueStorage,
  ReadyJobsQuery,
  StoredJob,
} from '@omni-queue/core';

/** Numeric sort weight (lower = dequeued first). */
const PRIORITY_SCORES: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Compute a combined sort score so that:
 *   - critical jobs always sort before high, before normal, before low
 *   - within the same priority, FIFO order by createdAt is preserved
 *
 * score = priorityWeight * 1e13 + createdAt
 *   (safe for timestamps up to ~Nov 2286)
 */
function readyScore(job: StoredJob): number {
  const weight = PRIORITY_SCORES[job.priority ?? 'normal'] ?? 2;
  return weight * 1e13 + job.createdAt;
}

export interface RedisStoreConfig {
  /**
   * A pre-configured ioredis instance, or an ioredis RedisOptions config object.
   */
  client: Redis | RedisOptions;

  /**
   * Key namespace prefix. Defaults to `omni`.
   */
  prefix?: string;
}

/**
 * Redis key layout:
 *
 *  omni:job:{id}               → JSON string of StoredJob
 *  omni:queue:{name}:ready     → sorted set, score = createdAt  (pending jobs)
 *  omni:queue:{name}:deferred  → sorted set, score = delayUntil (delayed jobs)
 *  omni:queue:{name}:leased    → sorted set, score = leaseUntil (inflight jobs)
 *  omni:dead:{id}              → JSON string of dead-lettered StoredJob
 *  omni:queue:{name}:dead      → sorted set, score = failedAt   (dead letter index)
 */
export class RedisStore implements QueueStorage {
  private client: Redis;
  private prefix: string;

  // Atomic dequeue + lease Lua script
  private static readonly DEQUEUE_SCRIPT = `
local ready_key  = KEYS[1]
local leased_key = KEYS[2]
local job_prefix = ARGV[1]
local now        = tonumber(ARGV[2])
local lease_until = tonumber(ARGV[3])
local batch_size  = tonumber(ARGV[4])

local priority_weights = {critical=0, high=1, normal=2, low=3}

-- 1. Reclaim expired leases back into ready (preserve priority order)
local expired = redis.call('ZRANGEBYSCORE', leased_key, 0, now)
for _, id in ipairs(expired) do
  local raw = redis.call('GET', job_prefix .. id)
  if raw then
    local ok, job = pcall(cjson.decode, raw)
    if ok and job then
      redis.call('ZREM', leased_key, id)
      local pw = priority_weights[job['priority'] or 'normal'] or 2
      local score = pw * 10000000000000 + (job['createdAt'] or 0)
      redis.call('ZADD', ready_key, score, id)
    end
  end
end

-- 2. Take up to batch_size items from ready (lowest score first)
local ids = redis.call('ZRANGE', ready_key, 0, batch_size - 1)
if #ids == 0 then return {} end

-- 3. Atomically move each to leased and update state in job data
for _, id in ipairs(ids) do
  redis.call('ZREM', ready_key, id)
  redis.call('ZADD', leased_key, lease_until, id)
  local raw = redis.call('GET', job_prefix .. id)
  if raw then
    local ok, job = pcall(cjson.decode, raw)
    if ok and job then
      job['state'] = 'leased'
      job['updatedAt'] = now
      redis.call('SET', job_prefix .. id, cjson.encode(job))
    end
  end
end

return ids
`;

  constructor(config: RedisStoreConfig) {
    this.client = config.client instanceof Redis ? config.client : new Redis(config.client);
    this.prefix = config.prefix ?? 'omni';
  }

  // ---------------------------------------------------------------------------
  // Key helpers
  // ---------------------------------------------------------------------------

  private jobKey(id: string) {
    return `${this.prefix}:job:${id}`;
  }

  private readyKey(queue: string) {
    return `${this.prefix}:queue:${queue}:ready`;
  }

  private deferredKey(queue: string) {
    return `${this.prefix}:queue:${queue}:deferred`;
  }

  private leasedKey(queue: string) {
    return `${this.prefix}:queue:${queue}:leased`;
  }

  private deadKey(queue: string) {
    return `${this.prefix}:queue:${queue}:dead`;
  }

  private deadJobKey(id: string) {
    return `${this.prefix}:dead:${id}`;
  }

  private completedKey(queue: string) {
    return `${this.prefix}:queue:${queue}:completed`;
  }

  // ---------------------------------------------------------------------------
  // QueueStorage interface
  // ---------------------------------------------------------------------------

  async enqueue(job: StoredJob): Promise<void> {
    const pipeline = this.client.pipeline();
    pipeline.set(this.jobKey(job.id), JSON.stringify(job));

    if (job.delayUntil != null) {
      pipeline.zadd(this.deferredKey(job.queue), job.delayUntil, job.id);
    } else {
      pipeline.zadd(this.readyKey(job.queue), readyScore(job), job.id);
    }

    await pipeline.exec();
  }

  async dequeue(options: LeaseOptions): Promise<StoredJob[]> {
    const { queue, batchSize, leaseMs } = options;

    if (!queue) {
      throw new Error('RedisStore.dequeue requires a queue name');
    }

    const now = Date.now();
    const leaseUntil = now + leaseMs;

    const ids = (await this.client.eval(
      RedisStore.DEQUEUE_SCRIPT,
      2,
      this.readyKey(queue),
      this.leasedKey(queue),
      `${this.prefix}:job:`,
      now,
      leaseUntil,
      batchSize
    )) as string[];

    if (!ids || ids.length === 0) return [];

    const pipeline = this.client.pipeline();
    for (const id of ids) {
      pipeline.get(this.jobKey(id));
    }

    const results = await pipeline.exec();
    const jobs: StoredJob[] = [];

    for (const result of results ?? []) {
      const [err, raw] = result as [Error | null, string | null];
      if (!err && raw) {
        jobs.push(JSON.parse(raw) as StoredJob);
      }
    }

    return jobs;
  }

  async ack(jobId: string): Promise<void> {
    // We need the queue name to remove from the leased set.
    // Read job first, then clean up.
    const raw = await this.client.get(this.jobKey(jobId));
    if (!raw) return;

    const job = JSON.parse(raw) as StoredJob;

    const pipeline = this.client.pipeline();
    pipeline.del(this.jobKey(jobId));
    pipeline.zrem(this.leasedKey(job.queue), jobId);
    await pipeline.exec();
  }

  async fail(jobId: string, err: Error): Promise<void> {
    const raw = await this.client.get(this.jobKey(jobId));
    if (!raw) return;

    const job = JSON.parse(raw) as StoredJob;
    const updated: StoredJob = { ...job, state: 'failed', updatedAt: Date.now() };

    await this.client.set(this.jobKey(jobId), JSON.stringify(updated));

    console.error(`[RedisStore] Job ${jobId} failed: ${err.message}`);
  }

  async moveToDeadLetter(job: StoredJob): Promise<void> {
    const failedAt = Date.now();
    const deadJob = { ...job, state: 'failed' as const, updatedAt: failedAt };

    const pipeline = this.client.pipeline();
    // Store dead-letter copy
    pipeline.set(this.deadJobKey(job.id), JSON.stringify(deadJob));
    pipeline.zadd(this.deadKey(job.queue), failedAt, job.id);
    // Remove from active tracking
    pipeline.del(this.jobKey(job.id));
    pipeline.zrem(this.leasedKey(job.queue), job.id);
    pipeline.zrem(this.readyKey(job.queue), job.id);
    pipeline.zrem(this.deferredKey(job.queue), job.id);
    await pipeline.exec();
  }

  async getQueueDepth(queue: string): Promise<number> {
    const [ready, deferred, leased] = await Promise.all([
      this.client.zcard(this.readyKey(queue)),
      this.client.zcard(this.deferredKey(queue)),
      this.client.zcard(this.leasedKey(queue)),
    ]);
    return ready + deferred + leased;
  }

  async extendLease(jobId: string, leaseMs: number): Promise<void> {
    const raw = await this.client.get(this.jobKey(jobId));
    if (!raw) return;

    const job = JSON.parse(raw) as StoredJob;
    const newLeaseUntil = Date.now() + leaseMs;

    await this.client.zadd(this.leasedKey(job.queue), newLeaseUntil, jobId);
  }

  async updateAttempts(id: string, attempts: number): Promise<void> {
    const raw = await this.client.get(this.jobKey(id));
    if (!raw) return;

    const job = JSON.parse(raw) as StoredJob;
    const updated: StoredJob = { ...job, attempts, updatedAt: Date.now() };

    await this.client.set(this.jobKey(id), JSON.stringify(updated));
  }

  // Delayed/Scheduled job support (Phase 1.1)
  async getDelayedJobs(queueName: string, beforeDate: number): Promise<StoredJob[]> {
    const ids = await this.client.zrangebyscore(this.deferredKey(queueName), 0, beforeDate);

    if (ids.length === 0) {
      return [];
    }

    const jobs = await this.getJobsByIds(ids);
    return jobs.filter(
      (job) =>
        job.queue === queueName &&
        job.state === 'queued' &&
        job.delayUntil != null &&
        job.delayUntil <= beforeDate
    );
  }

  async moveJobToQueue(
    queueName: string,
    jobId: string,
    toState: 'active' | 'deferred' | 'failed'
  ): Promise<void> {
    const raw = await this.client.get(this.jobKey(jobId));
    if (!raw) return;

    const job = JSON.parse(raw) as StoredJob;
    if (job.queue !== queueName) return;

    const pipeline = this.client.pipeline();

    if (toState === 'active') {
      const updated: StoredJob = {
        ...job,
        state: 'queued',
        updatedAt: Date.now(),
      };
      delete (updated as StoredJob & { delayUntil?: number }).delayUntil;

      pipeline.zrem(this.deferredKey(queueName), jobId);
      pipeline.zadd(this.readyKey(queueName), readyScore(updated), jobId);
      pipeline.set(this.jobKey(jobId), JSON.stringify(updated));
      await pipeline.exec();
      return;
    }

    if (toState === 'failed') {
      const updated: StoredJob = {
        ...job,
        state: 'failed',
        updatedAt: Date.now(),
      };

      pipeline.zrem(this.readyKey(queueName), jobId);
      if (updated.delayUntil != null) {
        pipeline.zadd(this.deferredKey(queueName), updated.delayUntil, jobId);
      }
      pipeline.set(this.jobKey(jobId), JSON.stringify(updated));
      await pipeline.exec();
      return;
    }

    if (job.delayUntil != null) {
      pipeline.zadd(this.deferredKey(queueName), job.delayUntil, jobId);
      pipeline.zrem(this.readyKey(queueName), jobId);
      await pipeline.exec();
    }
  }

  async queryDeferredJobs(query: {
    queueName?: string;
    status?: 'pending' | 'promoted' | 'failed';
    limit?: number;
    offset?: number;
  }): Promise<StoredJob[]> {
    const keys = query.queueName
      ? [this.deferredKey(query.queueName)]
      : await this.findDeferredKeys();

    if (keys.length === 0) {
      return [];
    }

    const pipeline = this.client.pipeline();
    for (const key of keys) {
      pipeline.zrange(key, 0, -1);
    }

    const results = await pipeline.exec();
    const ids = new Set<string>();
    for (const result of results ?? []) {
      const [err, members] = result as [Error | null, string[] | null];
      if (!err && members) {
        for (const member of members) {
          ids.add(member);
        }
      }
    }

    const now = Date.now();
    const jobs = await this.getJobsByIds([...ids]);
    const filtered = jobs.filter((job) => {
      if (job.delayUntil == null) return false;
      if (query.queueName && job.queue !== query.queueName) return false;

      if (query.status === 'pending') {
        return job.state === 'queued' && job.delayUntil > now;
      }

      if (query.status === 'promoted') {
        return job.state === 'queued' && job.delayUntil <= now;
      }

      if (query.status === 'failed') {
        return job.state === 'failed';
      }

      return true;
    });

    filtered.sort((a, b) => (a.delayUntil ?? 0) - (b.delayUntil ?? 0));

    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return filtered.slice(start, end);
  }

  // Dead Letter Queue (Phase 1.4)
  async getDeadLetterJobs(query: {
    queueName?: string;
    limit?: number;
    offset?: number;
  }): Promise<StoredJob[]> {
    const keys = query.queueName ? [this.deadKey(query.queueName)] : await this.findDeadKeys();
    if (keys.length === 0) return [];

    const pipeline = this.client.pipeline();
    for (const key of keys) {
      pipeline.zrange(key, 0, -1, 'REV');
    }

    const results = await pipeline.exec();
    const ids = new Set<string>();
    for (const result of results ?? []) {
      const [err, members] = result as [Error | null, string[] | null];
      if (!err && members) {
        for (const member of members) ids.add(member);
      }
    }

    const pipelineJobs = this.client.pipeline();
    for (const id of ids) {
      pipelineJobs.get(this.deadJobKey(id));
    }
    const jobResults = await pipelineJobs.exec();

    const jobs: StoredJob[] = [];
    for (const result of jobResults ?? []) {
      const [err, raw] = result as [Error | null, string | null];
      if (!err && raw) jobs.push(JSON.parse(raw) as StoredJob);
    }

    jobs.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return jobs.slice(start, end);
  }

  async retryDeadLetterJob(queueName: string, jobId: string): Promise<boolean> {
    const raw = await this.client.get(this.deadJobKey(jobId));
    if (!raw) return false;

    const deadJob = JSON.parse(raw) as StoredJob;
    if (deadJob.queue !== queueName) return false;

    const retried: StoredJob = {
      ...deadJob,
      state: 'queued',
      attempts: 0,
      updatedAt: Date.now(),
    };

    delete (retried as StoredJob & { delayUntil?: number }).delayUntil;

    const pipeline = this.client.pipeline();
    pipeline.zrem(this.deadKey(queueName), jobId);
    pipeline.del(this.deadJobKey(jobId));
    pipeline.set(this.jobKey(jobId), JSON.stringify(retried));
    pipeline.zadd(this.readyKey(queueName), readyScore(retried), jobId);
    await pipeline.exec();

    return true;
  }

  async promoteJob(queueName: string, jobId: string): Promise<boolean> {
    const raw = await this.client.get(this.jobKey(jobId));
    if (!raw) return false;

    const job = JSON.parse(raw) as StoredJob;
    if (job.queue !== queueName || job.state !== 'queued' || job.delayUntil == null) {
      return false;
    }

    await this.moveJobToQueue(queueName, jobId, 'active');
    return true;
  }

  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    const raw = await this.client.get(this.jobKey(jobId));
    if (raw) {
      const job = JSON.parse(raw) as StoredJob;
      if (job.queue === queueName) {
        const pipeline = this.client.pipeline();
        pipeline.del(this.jobKey(jobId));
        pipeline.zrem(this.readyKey(queueName), jobId);
        pipeline.zrem(this.deferredKey(queueName), jobId);
        pipeline.zrem(this.leasedKey(queueName), jobId);
        await pipeline.exec();
        return true;
      }
    }

    const deadRaw = await this.client.get(this.deadJobKey(jobId));
    if (deadRaw) {
      const deadJob = JSON.parse(deadRaw) as StoredJob;
      if (deadJob.queue === queueName) {
        const pipeline = this.client.pipeline();
        pipeline.del(this.deadJobKey(jobId));
        pipeline.zrem(this.deadKey(queueName), jobId);
        await pipeline.exec();
        return true;
      }
    }

    const completedRecords = await this.client.lrange(this.completedKey(queueName), 0, -1);
    for (const recordRaw of completedRecords) {
      const record = JSON.parse(recordRaw) as CompletedJobRecord;
      if (record.id !== jobId) continue;

      await this.client.lrem(this.completedKey(queueName), 1, recordRaw);
      return true;
    }

    return false;
  }

  async cleanJobs(queueName: string, options: QueueCleanOptions = {}): Promise<number> {
    const status = options.status ?? 'all';
    const limit = options.limit ?? 1000;
    const cutoff = Date.now() - Math.max(0, options.graceMs ?? 0);

    const statuses: QueueAdminJobStatus[] =
      status === 'all' ? ['ready', 'active', 'deferred', 'failed', 'completed'] : [status];

    let removed = 0;

    const collectQueueJobIds = async (currentStatus: QueueAdminJobStatus): Promise<string[]> => {
      if (currentStatus === 'ready') {
        return this.client.zrange(this.readyKey(queueName), 0, -1);
      }
      if (currentStatus === 'active') {
        return this.client.zrange(this.leasedKey(queueName), 0, -1);
      }
      if (currentStatus === 'deferred') {
        return this.client.zrange(this.deferredKey(queueName), 0, -1);
      }
      return [];
    };

    for (const currentStatus of statuses) {
      if (removed >= limit) break;

      if (currentStatus === 'ready' || currentStatus === 'active' || currentStatus === 'deferred') {
        const ids = await collectQueueJobIds(currentStatus);
        for (const id of ids) {
          if (removed >= limit) break;
          const raw = await this.client.get(this.jobKey(id));
          if (!raw) continue;

          const job = JSON.parse(raw) as StoredJob;
          const when = job.updatedAt ?? job.createdAt;
          if (when > cutoff) continue;

          const ok = await this.removeJob(queueName, id);
          if (ok) removed += 1;
        }
      }

      if (currentStatus === 'failed') {
        const ids = await this.client.zrange(this.deadKey(queueName), 0, -1);
        for (const id of ids) {
          if (removed >= limit) break;
          const raw = await this.client.get(this.deadJobKey(id));
          if (!raw) continue;

          const job = JSON.parse(raw) as StoredJob;
          const when = job.updatedAt ?? job.createdAt;
          if (when > cutoff) continue;

          const ok = await this.removeJob(queueName, id);
          if (ok) removed += 1;
        }
      }

      if (currentStatus === 'completed') {
        const records = await this.client.lrange(this.completedKey(queueName), 0, -1);
        for (const recordRaw of records) {
          if (removed >= limit) break;
          const record = JSON.parse(recordRaw) as CompletedJobRecord;
          if (record.completedAt > cutoff) continue;

          await this.client.lrem(this.completedKey(queueName), 1, recordRaw);
          removed += 1;
        }
      }
    }

    return removed;
  }

  async obliterateQueue(queueName: string): Promise<number> {
    const [readyIds, deferredIds, leasedIds, deadIds, completedCount] = await Promise.all([
      this.client.zrange(this.readyKey(queueName), 0, -1),
      this.client.zrange(this.deferredKey(queueName), 0, -1),
      this.client.zrange(this.leasedKey(queueName), 0, -1),
      this.client.zrange(this.deadKey(queueName), 0, -1),
      this.client.llen(this.completedKey(queueName)),
    ]);

    const ids = new Set<string>([...readyIds, ...deferredIds, ...leasedIds]);
    const pipeline = this.client.pipeline();

    for (const id of ids) {
      pipeline.del(this.jobKey(id));
    }
    for (const id of deadIds) {
      pipeline.del(this.deadJobKey(id));
    }

    pipeline.del(this.readyKey(queueName));
    pipeline.del(this.deferredKey(queueName));
    pipeline.del(this.leasedKey(queueName));
    pipeline.del(this.deadKey(queueName));
    pipeline.del(this.completedKey(queueName));
    await pipeline.exec();

    return ids.size + deadIds.length + completedCount;
  }

  /**
   * Close the underlying Redis connection.
   */
  async close(): Promise<void> {
    await this.client.quit();
  }

  // Progress tracking (Phase 1.3)
  async setJobProgress(jobId: string, progress: number): Promise<void> {
    const raw = await this.client.get(this.jobKey(jobId));
    if (!raw) return;
    const job = JSON.parse(raw) as StoredJob;
    const updated: StoredJob = { ...job, progress, updatedAt: Date.now() };
    await this.client.set(this.jobKey(jobId), JSON.stringify(updated));
  }

  // Ready and Active job visibility (Phase 2)
  async getReadyJobs(query: ReadyJobsQuery): Promise<StoredJob[]> {
    const keys = query.queueName ? [this.readyKey(query.queueName)] : await this.findReadyKeys();
    if (keys.length === 0) return [];

    const ids = await this.collectIdsFromSortedSets(keys, false);
    const jobs = await this.getJobsByIds(ids);
    const filtered = jobs.filter((job) => {
      if (query.queueName && job.queue !== query.queueName) return false;
      return job.state === 'queued' && job.delayUntil == null;
    });

    filtered.sort((a, b) => readyScore(a) - readyScore(b));
    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return filtered.slice(start, end);
  }

  async getActiveJobs(query: ActiveJobsQuery): Promise<StoredJob[]> {
    const keys = query.queueName ? [this.leasedKey(query.queueName)] : await this.findLeasedKeys();
    if (keys.length === 0) return [];

    const ids = await this.collectIdsFromSortedSets(keys, false);
    const jobs = await this.getJobsByIds(ids);
    const filtered = jobs.filter((job) => {
      if (query.queueName && job.queue !== query.queueName) return false;
      return job.state === 'leased';
    });

    filtered.sort((a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt));
    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return filtered.slice(start, end);
  }

  // Completed job history (Horizon-style)
  async addCompletedJob(job: StoredJob, result?: unknown): Promise<void> {
    const completedAt = Date.now();
    const completed: CompletedJobRecord = {
      ...job,
      state: 'completed',
      updatedAt: completedAt,
      completedAt,
      ...(result !== undefined ? { result } : {}),
    };

    const key = this.completedKey(job.queue);
    const pipeline = this.client.pipeline();
    pipeline.lpush(key, JSON.stringify(completed));
    pipeline.ltrim(key, 0, 499);
    await pipeline.exec();
  }

  async getCompletedJobs(query: CompletedJobsQuery): Promise<CompletedJobRecord[]> {
    const keys = query.queueName ? [this.completedKey(query.queueName)] : await this.findCompletedKeys();
    if (keys.length === 0) return [];

    const pipeline = this.client.pipeline();
    for (const key of keys) {
      pipeline.lrange(key, 0, -1);
    }

    const results = await pipeline.exec();
    const completed: CompletedJobRecord[] = [];

    for (const result of results ?? []) {
      const [err, records] = result as [Error | null, string[] | null];
      if (err || !records) continue;
      for (const raw of records) {
        completed.push(JSON.parse(raw) as CompletedJobRecord);
      }
    }

    completed.sort((a, b) => b.completedAt - a.completedAt);
    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return completed.slice(start, end);
  }

  private async getJobsByIds(ids: string[]): Promise<StoredJob[]> {
    if (ids.length === 0) {
      return [];
    }

    const pipeline = this.client.pipeline();
    for (const id of ids) {
      pipeline.get(this.jobKey(id));
    }

    const results = await pipeline.exec();
    const jobs: StoredJob[] = [];

    for (const result of results ?? []) {
      const [err, raw] = result as [Error | null, string | null];
      if (!err && raw) {
        jobs.push(JSON.parse(raw) as StoredJob);
      }
    }

    return jobs;
  }

  private async findDeferredKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    const pattern = `${this.prefix}:queue:*:deferred`;

    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  private async findDeadKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    const pattern = `${this.prefix}:queue:*:dead`;

    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  private async findReadyKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    const pattern = `${this.prefix}:queue:*:ready`;

    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  private async findLeasedKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    const pattern = `${this.prefix}:queue:*:leased`;

    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  private async findCompletedKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    const pattern = `${this.prefix}:queue:*:completed`;

    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  private async collectIdsFromSortedSets(keys: string[], reverse: boolean): Promise<string[]> {
    const pipeline = this.client.pipeline();
    for (const key of keys) {
      if (reverse) {
        pipeline.zrange(key, 0, -1, 'REV');
      } else {
        pipeline.zrange(key, 0, -1);
      }
    }

    const results = await pipeline.exec();
    const ids: string[] = [];
    for (const result of results ?? []) {
      const [err, members] = result as [Error | null, string[] | null];
      if (!err && members) {
        ids.push(...members);
      }
    }

    return ids;
  }
}
