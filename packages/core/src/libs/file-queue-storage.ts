import fs from 'node:fs';
import path from 'node:path';
import {
  ActiveJobsQuery,
  CompletedJobsQuery,
  DeadLetterQuery,
  DeferredJobsQuery,
  LeaseOptions,
  QueueStorage,
  ReadyJobsQuery,
} from '../interfaces/queue-storage';
import { CompletedJobRecord, StoredJob } from '../types';

type LeasedJob = StoredJob & { _leaseExpiry: number };

/**
 * Local development storage that shares queue state across processes via JSON files.
 */
export class FileQueueStorage implements QueueStorage {
  private queuedDir: string;
  private leasedDir: string;
  private deadDir: string;
  private completedDir: string;

  constructor(dataDir: string = './queue-data') {
    this.queuedDir = path.resolve(dataDir, 'queued');
    this.leasedDir = path.resolve(dataDir, 'leased');
    this.deadDir = path.resolve(dataDir, 'dead');
    this.completedDir = path.resolve(dataDir, 'completed');

    fs.mkdirSync(this.queuedDir, { recursive: true });
    fs.mkdirSync(this.leasedDir, { recursive: true });
    fs.mkdirSync(this.deadDir, { recursive: true });
    fs.mkdirSync(this.completedDir, { recursive: true });
  }

  async enqueue(job: StoredJob): Promise<void> {
    const filePath = path.join(this.queuedDir, `${job.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ ...job, state: 'queued' }));
  }

  async dequeue(options: LeaseOptions): Promise<StoredJob[]> {
    const { queue, batchSize, leaseMs } = options;
    const now = Date.now();
    const results: StoredJob[] = [];

    const queuedFiles = this.listJson(this.queuedDir);

    for (const file of queuedFiles) {
      if (results.length >= batchSize) break;

      const src = path.join(this.queuedDir, file);
      const dst = path.join(this.leasedDir, file);

      try {
        const job: StoredJob = this.readJson(src);
        if (queue && job.queue !== queue) continue;
        if (job.delayUntil !== undefined) continue;

        fs.renameSync(src, dst);

        const leased: LeasedJob = {
          ...job,
          state: 'leased',
          updatedAt: now,
          _leaseExpiry: now + leaseMs,
        };
        fs.writeFileSync(dst, JSON.stringify(leased));
        results.push(leased);
      } catch {
        // Another worker claimed this file.
      }
    }

    if (results.length < batchSize) {
      const leasedFiles = this.listJson(this.leasedDir);

      for (const file of leasedFiles) {
        if (results.length >= batchSize) break;

        const filePath = path.join(this.leasedDir, file);

        try {
          const job = this.readJson<LeasedJob>(filePath);
          if (queue && job.queue !== queue) continue;
          if ((job._leaseExpiry ?? 0) > now) continue;

          const reclaimed: LeasedJob = {
            ...job,
            state: 'leased',
            updatedAt: now,
            _leaseExpiry: now + leaseMs,
          };
          fs.writeFileSync(filePath, JSON.stringify(reclaimed));
          results.push(reclaimed);
        } catch {
          // File disappeared while scanning.
        }
      }
    }

    return results;
  }

  async ack(jobId: string): Promise<void> {
    this.silentUnlink(path.join(this.leasedDir, `${jobId}.json`));
  }

  async fail(jobId: string, _err: Error): Promise<void> {
    const filePath = path.join(this.leasedDir, `${jobId}.json`);
    try {
      const job = this.readJson<StoredJob>(filePath);
      fs.writeFileSync(filePath, JSON.stringify({ ...job, state: 'failed', updatedAt: Date.now() }));
    } catch {
      // Job file already gone.
    }
  }

  async moveToDeadLetter(job: StoredJob): Promise<void> {
    const leasedSrc = path.join(this.leasedDir, `${job.id}.json`);
    const queuedSrc = path.join(this.queuedDir, `${job.id}.json`);
    const dst = path.join(this.deadDir, `${job.id}.json`);

    const src = fs.existsSync(leasedSrc)
      ? leasedSrc
      : fs.existsSync(queuedSrc)
        ? queuedSrc
        : undefined;

    try {
      if (src) {
        fs.renameSync(src, dst);
      }
      const dead: StoredJob = { ...job, state: 'failed', updatedAt: Date.now() };
      fs.writeFileSync(dst, JSON.stringify(dead));
    } catch {
      const dead: StoredJob = { ...job, state: 'failed', updatedAt: Date.now() };
      fs.writeFileSync(dst, JSON.stringify(dead));
    }
  }

  async getQueueDepth(queue: string): Promise<number> {
    let count = 0;

    for (const file of this.listJson(this.queuedDir)) {
      try {
        const job = this.readJson<StoredJob>(path.join(this.queuedDir, file));
        if (job.queue === queue) count++;
      } catch {
        // ignore
      }
    }

    return count;
  }

  async extendLease(jobId: string, leaseMs: number): Promise<void> {
    const filePath = path.join(this.leasedDir, `${jobId}.json`);
    try {
      const job = this.readJson<LeasedJob>(filePath);
      fs.writeFileSync(filePath, JSON.stringify({ ...job, _leaseExpiry: Date.now() + leaseMs }));
    } catch {
      // ignore
    }
  }

  async updateAttempts(jobId: string, attempts: number): Promise<void> {
    const filePath = path.join(this.leasedDir, `${jobId}.json`);
    try {
      const job = this.readJson<StoredJob>(filePath);
      fs.writeFileSync(filePath, JSON.stringify({ ...job, attempts, updatedAt: Date.now() }));
    } catch {
      // ignore
    }
  }

  async getDelayedJobs(queueName: string, beforeDate: number): Promise<StoredJob[]> {
    const delayedJobs: StoredJob[] = [];

    for (const file of this.listJson(this.queuedDir)) {
      try {
        const job = this.readJson<StoredJob>(path.join(this.queuedDir, file));
        if (
          job.queue === queueName &&
          job.state === 'queued' &&
          job.delayUntil !== undefined &&
          job.delayUntil <= beforeDate
        ) {
          delayedJobs.push(job);
        }
      } catch {
        // ignore
      }
    }

    return delayedJobs;
  }

  async moveJobToQueue(queueName: string, jobId: string, toState: 'active' | 'deferred' | 'failed'): Promise<void> {
    const queuedPath = path.join(this.queuedDir, `${jobId}.json`);

    try {
      const job = this.readJson<StoredJob>(queuedPath);
      if (job.queue !== queueName) return;

      const updated: StoredJob = {
        ...job,
        state: toState === 'active' ? 'queued' : toState === 'failed' ? 'failed' : 'queued',
        updatedAt: Date.now(),
      };

      if (toState === 'active') {
        delete (updated as StoredJob & { delayUntil?: number }).delayUntil;
      }

      fs.writeFileSync(queuedPath, JSON.stringify(updated));
    } catch {
      // ignore
    }
  }

  async queryDeferredJobs(query: DeferredJobsQuery): Promise<StoredJob[]> {
    const deferredJobs: StoredJob[] = [];

    for (const file of this.listJson(this.queuedDir)) {
      try {
        const job = this.readJson<StoredJob>(path.join(this.queuedDir, file));

        if (job.delayUntil === undefined) continue;
        if (query.queueName && job.queue !== query.queueName) continue;

        if (query.status === 'pending' && job.delayUntil <= Date.now()) continue;
        if (query.status === 'promoted' && job.delayUntil > Date.now()) continue;
        if (query.status === 'failed' && job.state !== 'failed') continue;

        deferredJobs.push(job);
      } catch {
        // ignore
      }
    }

    const start = query.offset ?? 0;
    const end = query.limit ? start + query.limit : deferredJobs.length;
    return deferredJobs.slice(start, end);
  }

  async setJobProgress(jobId: string, progress: number): Promise<void> {
    const queuedPath = path.join(this.queuedDir, `${jobId}.json`);
    const leasedPath = path.join(this.leasedDir, `${jobId}.json`);

    for (const filePath of [leasedPath, queuedPath]) {
      try {
        const job = this.readJson<StoredJob>(filePath);
        fs.writeFileSync(
          filePath,
          JSON.stringify({
            ...job,
            progress,
            updatedAt: Date.now(),
          })
        );
        return;
      } catch {
        // try next location
      }
    }
  }

  async getReadyJobs(query: ReadyJobsQuery): Promise<StoredJob[]> {
    const readyJobs: StoredJob[] = [];

    for (const file of this.listJson(this.queuedDir)) {
      try {
        const job = this.readJson<StoredJob>(path.join(this.queuedDir, file));
        if (query.queueName && job.queue !== query.queueName) continue;
        if (job.state !== 'queued') continue;
        if (job.delayUntil !== undefined) continue;
        readyJobs.push(job);
      } catch {
        // ignore
      }
    }

    readyJobs.sort((a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt));
    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return readyJobs.slice(start, end);
  }

  async getActiveJobs(query: ActiveJobsQuery): Promise<StoredJob[]> {
    const activeJobs: StoredJob[] = [];

    for (const file of this.listJson(this.leasedDir)) {
      try {
        const job = this.readJson<StoredJob>(path.join(this.leasedDir, file));
        if (query.queueName && job.queue !== query.queueName) continue;
        if (job.state !== 'leased') continue;
        activeJobs.push(job);
      } catch {
        // ignore
      }
    }

    activeJobs.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return activeJobs.slice(start, end);
  }

  async getDeadLetterJobs(query: DeadLetterQuery): Promise<StoredJob[]> {
    const deadJobs: StoredJob[] = [];

    for (const file of this.listJson(this.deadDir)) {
      try {
        const job = this.readJson<StoredJob>(path.join(this.deadDir, file));
        if (query.queueName && job.queue !== query.queueName) continue;
        deadJobs.push(job);
      } catch {
        // ignore
      }
    }

    deadJobs.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return deadJobs.slice(start, end);
  }

  async retryDeadLetterJob(queueName: string, jobId: string): Promise<boolean> {
    const deadPath = path.join(this.deadDir, `${jobId}.json`);

    try {
      const deadJob = this.readJson<StoredJob>(deadPath);
      if (deadJob.queue !== queueName) return false;
      if (deadJob.retriedAt != null) return false;

      const now = Date.now();
      const retriedJobId = crypto.randomUUID();
      const queuedPath = path.join(this.queuedDir, `${retriedJobId}.json`);

      const retried: StoredJob = {
        ...deadJob,
        id: retriedJobId,
        state: 'queued',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      };

      delete (retried as StoredJob & { delayUntil?: number }).delayUntil;
      delete (retried as StoredJob & { errorDetails?: StoredJob['errorDetails'] }).errorDetails;
      delete (retried as StoredJob & { idempotencyKey?: string }).idempotencyKey;
      delete (retried as StoredJob & { retriedAt?: number }).retriedAt;
      delete (retried as StoredJob & { retriedJobId?: string }).retriedJobId;

      fs.writeFileSync(queuedPath, JSON.stringify(retried));
      fs.writeFileSync(
        deadPath,
        JSON.stringify({
          ...deadJob,
          retriedAt: now,
          retriedJobId,
          updatedAt: now,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async addCompletedJob(job: StoredJob, result?: unknown): Promise<void> {
    const completedAt = Date.now();
    const filePath = path.join(this.completedDir, `${job.id}.json`);
    const record: CompletedJobRecord = {
      ...job,
      state: 'completed',
      updatedAt: completedAt,
      completedAt,
      ...(result !== undefined ? { result } : {}),
    };

    fs.writeFileSync(filePath, JSON.stringify(record));
  }

  async getCompletedJobs(query: CompletedJobsQuery): Promise<CompletedJobRecord[]> {
    const completedJobs: CompletedJobRecord[] = [];

    for (const file of this.listJson(this.completedDir)) {
      try {
        const job = this.readJson<CompletedJobRecord>(path.join(this.completedDir, file));
        if (query.queueName && job.queue !== query.queueName) continue;
        completedJobs.push(job);
      } catch {
        // ignore
      }
    }

    completedJobs.sort((a, b) => b.completedAt - a.completedAt);
    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return completedJobs.slice(start, end);
  }

  private listJson(dir: string): string[] {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  }

  private readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  }

  private silentUnlink(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // already deleted
    }
  }
}
