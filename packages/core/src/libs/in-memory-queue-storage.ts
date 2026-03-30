import {
  ActiveJobsQuery,
  CompletedJobsQuery,
  DeferredJobsQuery,
  LeaseOptions,
  QueueAdminJobStatus,
  QueueCleanOptions,
  QueueStorage,
  ReadyJobsQuery,
} from '../interfaces/queue-storage';
import { CompletedJobRecord, StoredJob } from '../types';
import { priorityScore } from '../utils';

export class InMemoryQueueStorage implements QueueStorage {
  private jobs = new Map<string, StoredJob>();
  private deadLetter = new Map<string, StoredJob[]>();
  private completed = new Map<string, CompletedJobRecord[]>();
  private leaseExpiry = new Map<string, number>();
  private idempotencyIndex = new Map<string, string>();

  async enqueue(job: StoredJob): Promise<void> {
    if (job.idempotencyKey) {
      const existingId = this.idempotencyIndex.get(job.idempotencyKey);
      if (existingId && this.jobs.has(existingId)) {
        return;
      }
    }

    const record: StoredJob = {
      ...job,
      state: 'queued',
      updatedAt: Date.now(),
    };

    this.jobs.set(record.id, record);

    if (record.idempotencyKey) {
      this.idempotencyIndex.set(record.idempotencyKey, record.id);
    }
  }

  async dequeue(options: LeaseOptions): Promise<StoredJob[]> {
    const now = Date.now();
    const { queue, batchSize, leaseMs } = options;

    const candidates = Array.from(this.jobs.values())
      .filter((job) => {
        if (queue && job.queue !== queue) {
          return false;
        }

        if (job.state === 'queued') {
          return job.delayUntil === undefined;
        }

        if (job.state === 'leased') {
          const expiresAt = this.leaseExpiry.get(job.id) ?? 0;
          return expiresAt <= now;
        }

        return false;
      })
      .sort((a, b) => {
        const pd = priorityScore(a.priority) - priorityScore(b.priority);
        return pd !== 0 ? pd : a.createdAt - b.createdAt;
      })
      .slice(0, batchSize);

    const leaseUntil = now + leaseMs;

    const leasedJobs = candidates.map((job) => {
      const leased: StoredJob = {
        ...job,
        state: 'leased',
        updatedAt: now,
      };

      this.jobs.set(leased.id, leased);
      this.leaseExpiry.set(leased.id, leaseUntil);

      return leased;
    });

    return leasedJobs;
  }

  async ack(jobId: string): Promise<void> {
    this.removeJobRecord(jobId);
  }

  async fail(jobId: string, _err: Error): Promise<void> {
    const job = this.jobs.get(jobId);

    if (!job) {
      return;
    }

    this.jobs.set(jobId, {
      ...job,
      state: 'failed',
      updatedAt: Date.now(),
    });

    this.leaseExpiry.delete(jobId);
  }

  async moveToDeadLetter(job: StoredJob): Promise<void> {
    const queueDeadLetter = this.deadLetter.get(job.queue) ?? [];

    queueDeadLetter.push({
      ...job,
      state: 'failed',
      updatedAt: Date.now(),
    });

    this.deadLetter.set(job.queue, queueDeadLetter);
    this.removeJobRecord(job.id);
  }

  async getQueueDepth(queue: string): Promise<number> {
    let count = 0;

    for (const job of this.jobs.values()) {
      if (job.queue === queue && (job.state === 'queued' || job.state === 'leased')) {
        count += 1;
      }
    }

    return count;
  }

  async extendLease(jobId: string, leaseMs: number): Promise<void> {
    const job = this.jobs.get(jobId);

    if (!job || job.state !== 'leased') {
      return;
    }

    this.leaseExpiry.set(jobId, Date.now() + leaseMs);
    this.jobs.set(jobId, {
      ...job,
      updatedAt: Date.now(),
    });
  }

  async updateAttempts(id: string, attempts: number): Promise<void> {
    const job = this.jobs.get(id);

    if (!job) {
      return;
    }

    this.jobs.set(id, {
      ...job,
      attempts,
      updatedAt: Date.now(),
    });
  }

  getJob(id: string): StoredJob | undefined {
    return this.jobs.get(id);
  }

  getDeadLetter(queue: string): StoredJob[] {
    return [...(this.deadLetter.get(queue) ?? [])];
  }

  async getDeadLetterJobs(query: { queueName?: string; limit?: number; offset?: number }): Promise<StoredJob[]> {
    const queues = query.queueName ? [query.queueName] : Array.from(this.deadLetter.keys());
    const merged: StoredJob[] = [];

    for (const queueName of queues) {
      merged.push(...(this.deadLetter.get(queueName) ?? []));
    }

    merged.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));

    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return merged.slice(start, end);
  }

  async retryDeadLetterJob(queueName: string, jobId: string): Promise<boolean> {
    const queueDeadLetter = this.deadLetter.get(queueName) ?? [];
    const index = queueDeadLetter.findIndex((job) => job.id === jobId);
    if (index < 0) return false;

    const [deadJob] = queueDeadLetter.splice(index, 1);
    this.deadLetter.set(queueName, queueDeadLetter);

    const retried: StoredJob = {
      ...deadJob!,
      state: 'queued',
      attempts: 0,
      updatedAt: Date.now(),
    };

    this.jobs.set(retried.id, retried);
    return true;
  }

  // Delayed/Scheduled job support (Phase 1.1)
  async getDelayedJobs(queueName: string, beforeDate: number): Promise<StoredJob[]> {
    return Array.from(this.jobs.values()).filter(
      (job) =>
        job.queue === queueName &&
        job.delayUntil !== undefined &&
        job.delayUntil <= beforeDate &&
        job.state === 'queued'
    );
  }

  async moveJobToQueue(
    queueName: string,
    jobId: string,
    toState: 'active' | 'deferred' | 'failed'
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    if (job.queue !== queueName) return;

    // Update job state (active queue = 'queued', deferred = stays as is)
    if (toState === 'active') {
      job.state = 'queued';
      // Remove delay by deleting the property
      delete (job as any).delayUntil;
    } else if (toState === 'failed') {
      job.state = 'failed';
    }

    job.updatedAt = Date.now();
  }

  async queryDeferredJobs(query: DeferredJobsQuery): Promise<StoredJob[]> {
    const now = Date.now();
    const result = Array.from(this.jobs.values()).filter((job) => {
      if (query.queueName && job.queue !== query.queueName) {
        return false;
      }

      if (job.delayUntil === undefined) {
        return false;
      }

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

    const start = query.offset || 0;
    const end = query.limit ? start + query.limit : result.length;

    return result.slice(start, end);
  }

  // Progress tracking (Phase 1.3)
  async setJobProgress(jobId: string, progress: number): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.jobs.set(jobId, { ...job, progress, updatedAt: Date.now() });
  }

  // Ready and Active job visibility (Phase 2)
  async getReadyJobs(query: ReadyJobsQuery): Promise<StoredJob[]> {
    const result = Array.from(this.jobs.values()).filter((job) => {
      if (query.queueName && job.queue !== query.queueName) {
        return false;
      }
      // Ready jobs are queued without a delay
      return job.state === 'queued' && job.delayUntil === undefined;
    });

    result.sort((a, b) => {
      const pd = priorityScore(a.priority) - priorityScore(b.priority);
      return pd !== 0 ? pd : a.createdAt - b.createdAt;
    });

    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return result.slice(start, end);
  }

  async getActiveJobs(query: ActiveJobsQuery): Promise<StoredJob[]> {
    const result = Array.from(this.jobs.values()).filter((job) => {
      if (query.queueName && job.queue !== query.queueName) {
        return false;
      }
      // Active jobs are leased (in progress)
      return job.state === 'leased';
    });

    result.sort((a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt));

    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return result.slice(start, end);
  }

  async addCompletedJob(job: StoredJob, result?: unknown): Promise<void> {
    const queueCompleted = this.completed.get(job.queue) ?? [];
    const completedAt = Date.now();

    queueCompleted.unshift({
      ...job,
      state: 'completed',
      updatedAt: completedAt,
      completedAt,
      ...(result !== undefined ? { result } : {}),
    });

    this.completed.set(job.queue, queueCompleted.slice(0, 500));
  }

  async getCompletedJobs(query: CompletedJobsQuery): Promise<CompletedJobRecord[]> {
    const queues = query.queueName ? [query.queueName] : Array.from(this.completed.keys());
    const merged: CompletedJobRecord[] = [];

    for (const queueName of queues) {
      merged.push(...(this.completed.get(queueName) ?? []));
    }

    merged.sort((a, b) => b.completedAt - a.completedAt);

    const start = query.offset ?? 0;
    const end = query.limit != null ? start + query.limit : undefined;
    return merged.slice(start, end);
  }

  async promoteJob(queueName: string, jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.queue !== queueName || job.state !== 'queued' || job.delayUntil === undefined) {
      return false;
    }

    const updated: StoredJob = {
      ...job,
      state: 'queued',
      updatedAt: Date.now(),
    };
    delete (updated as StoredJob & { delayUntil?: number }).delayUntil;

    this.jobs.set(jobId, updated);
    return true;
  }

  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (job && job.queue === queueName) {
      this.removeJobRecord(jobId);
      return true;
    }

    const queueDeadLetter = this.deadLetter.get(queueName) ?? [];
    const deadLetterIndex = queueDeadLetter.findIndex((item) => item.id === jobId);
    if (deadLetterIndex >= 0) {
      queueDeadLetter.splice(deadLetterIndex, 1);
      this.deadLetter.set(queueName, queueDeadLetter);
      return true;
    }

    const queueCompleted = this.completed.get(queueName) ?? [];
    const completedIndex = queueCompleted.findIndex((item) => item.id === jobId);
    if (completedIndex >= 0) {
      queueCompleted.splice(completedIndex, 1);
      this.completed.set(queueName, queueCompleted);
      return true;
    }

    return false;
  }

  async cleanJobs(queueName: string, options: QueueCleanOptions = {}): Promise<number> {
    const cutoff = Date.now() - Math.max(0, options.graceMs ?? 0);
    const limit = options.limit ?? 1000;
    const status = options.status ?? 'all';

    const statuses: QueueAdminJobStatus[] =
      status === 'all' ? ['ready', 'active', 'deferred', 'failed', 'completed'] : [status];

    let removed = 0;

    const canRemoveJob = (job: StoredJob, currentStatus: QueueAdminJobStatus): boolean => {
      if (job.queue !== queueName) return false;

      if (currentStatus === 'ready') return job.state === 'queued' && job.delayUntil === undefined;
      if (currentStatus === 'active') return job.state === 'leased';
      if (currentStatus === 'deferred') return job.delayUntil !== undefined;
      return false;
    };

    for (const currentStatus of statuses) {
      if (removed >= limit) break;

      if (currentStatus === 'ready' || currentStatus === 'active' || currentStatus === 'deferred') {
        for (const job of Array.from(this.jobs.values())) {
          if (removed >= limit) break;
          if (!canRemoveJob(job, currentStatus)) continue;
          const when = job.updatedAt ?? job.createdAt;
          if (when > cutoff) continue;

          this.removeJobRecord(job.id);
          removed += 1;
        }
      }

      if (currentStatus === 'failed') {
        const queueDeadLetter = this.deadLetter.get(queueName) ?? [];
        const kept: StoredJob[] = [];
        for (const job of queueDeadLetter) {
          const when = job.updatedAt ?? job.createdAt;
          const shouldRemove = removed < limit && when <= cutoff;
          if (shouldRemove) {
            removed += 1;
          } else {
            kept.push(job);
          }
        }
        this.deadLetter.set(queueName, kept);
      }

      if (currentStatus === 'completed') {
        const queueCompleted = this.completed.get(queueName) ?? [];
        const kept: CompletedJobRecord[] = [];
        for (const job of queueCompleted) {
          const shouldRemove = removed < limit && job.completedAt <= cutoff;
          if (shouldRemove) {
            removed += 1;
          } else {
            kept.push(job);
          }
        }
        this.completed.set(queueName, kept);
      }
    }

    return removed;
  }

  async obliterateQueue(queueName: string): Promise<number> {
    let removed = 0;

    for (const job of Array.from(this.jobs.values())) {
      if (job.queue !== queueName) continue;
      this.removeJobRecord(job.id);
      removed += 1;
    }

    removed += (this.deadLetter.get(queueName) ?? []).length;
    removed += (this.completed.get(queueName) ?? []).length;

    this.deadLetter.delete(queueName);
    this.completed.delete(queueName);

    return removed;
  }

  clear(): void {
    this.jobs.clear();
    this.deadLetter.clear();
    this.completed.clear();
    this.leaseExpiry.clear();
    this.idempotencyIndex.clear();
  }

  private removeJobRecord(jobId: string): void {
    const job = this.jobs.get(jobId);

    if (!job) {
      return;
    }

    this.jobs.delete(jobId);
    this.leaseExpiry.delete(jobId);

    if (job.idempotencyKey) {
      this.idempotencyIndex.delete(job.idempotencyKey);
    }
  }
}
