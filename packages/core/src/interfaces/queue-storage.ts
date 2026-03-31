/* eslint-disable @typescript-eslint/no-explicit-any */

// import { Job } from '../contracts/job';
import { CompletedJobRecord, StoredJob } from '../types';

export interface LeaseOptions {
  queue?: string;
  batchSize: number;
  leaseMs: number;
}

export interface DeferredJobsQuery {
  queueName?: string;
  status?: 'pending' | 'promoted' | 'failed';
  limit?: number;
  offset?: number;
}

export interface DeadLetterQuery {
  queueName?: string;
  limit?: number;
  offset?: number;
}

export interface ReadyJobsQuery {
  queueName?: string;
  limit?: number;
  offset?: number;
}

export interface ActiveJobsQuery {
  queueName?: string;
  limit?: number;
  offset?: number;
}

export interface CompletedJobsQuery {
  queueName?: string;
  limit?: number;
  offset?: number;
}

export interface JobArchiveQuery {
  queueName?: string;
  jobName?: string;
  search?: string;
  fromTs?: number;
  toTs?: number;
  limit?: number;
  offset?: number;
}

export interface ArchiveRetentionPolicy {
  retentionMs?: number;
  maxRowsPerQueue?: number;
}

export type QueueAdminJobStatus = 'ready' | 'active' | 'deferred' | 'failed' | 'completed' | 'all';

export interface QueueCleanOptions {
  status?: QueueAdminJobStatus;
  graceMs?: number;
  limit?: number;
}

export interface RateLimitConsumeRequest {
  queueName: string;
  consumerId: string;
  queueCapacity: number;
  queueRefillRate: number;
  consumerCapacity?: number;
  consumerRefillRate?: number;
}

export interface QueueStorage {
  enqueue(job: StoredJob): Promise<void>;
  dequeue(options: LeaseOptions): Promise<StoredJob[]>;
  ack(jobId: string): Promise<void>;
  fail(jobId: string, err: Error): Promise<void>;
  moveToDeadLetter(job: StoredJob): Promise<void>;
  getQueueDepth(queue: string): Promise<number>;
  extendLease(jobId: string, leaseMs: number): Promise<void>;
  updateAttempts(id: string, attempts: number): Promise<void>;

  // Delayed/Scheduled job support (Phase 1.1)
  getDelayedJobs(queueName: string, beforeDate: number): Promise<StoredJob[]>;
  moveJobToQueue(queueName: string, jobId: string, toState: 'active' | 'deferred' | 'failed'): Promise<void>;
  queryDeferredJobs(query: DeferredJobsQuery): Promise<StoredJob[]>;

  // Progress tracking (Phase 1.3)
  setJobProgress(jobId: string, progress: number): Promise<void>;

  // Dead Letter Queue (Phase 1.4)
  getDeadLetterJobs(query: DeadLetterQuery): Promise<StoredJob[]>;
  retryDeadLetterJob(queueName: string, jobId: string): Promise<boolean>;

  // Ready and Active job visibility (Phase 2)
  getReadyJobs(query: ReadyJobsQuery): Promise<StoredJob[]>;
  getActiveJobs(query: ActiveJobsQuery): Promise<StoredJob[]>;

  // Completed job history (Horizon-style)
  addCompletedJob(job: StoredJob, result?: unknown): Promise<void>;
  getCompletedJobs(query: CompletedJobsQuery): Promise<CompletedJobRecord[]>;

  // Archive & audit (Phase 2.3)
  queryJobArchive?(query: JobArchiveQuery): Promise<CompletedJobRecord[]>;
  setArchiveRetentionPolicy?(policy: ArchiveRetentionPolicy): void;

  // Optional distributed/global rate limiting primitive.
  // Implementations should consume queue and consumer tokens atomically.
  consumeRateLimitToken?(request: RateLimitConsumeRequest): Promise<boolean>;

  // Job administration (Phase 4.4.3)
  promoteJob?(queueName: string, jobId: string): Promise<boolean>;
  removeJob?(queueName: string, jobId: string): Promise<boolean>;
  cleanJobs?(queueName: string, options?: QueueCleanOptions): Promise<number>;
  obliterateQueue?(queueName: string): Promise<number>;
}
