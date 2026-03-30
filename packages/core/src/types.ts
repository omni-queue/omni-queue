import { Job } from './contracts/job';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type IsolationType = 'thread' | 'process' | 'inline';

export type QueueState = 'queued' | 'processing' | 'failed' | 'completed';

export type BackOffType = 'exponential' | 'fixed';

export type JobState = 'queued' | 'leased' | 'processing' | 'failed' | 'completed';

/**
 * Job-level priority (Phase 1.2).
 * Lower value = dequeued first: critical → high → normal → low
 */
export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

export type ExecutionContext = {
  job: StoredJob;
  instance: Job;
};

export type JobConstructor = {
  new (...args: any[]): Job;
  jobName: string;
};

export interface StoredJob {
  id: string;
  name: string;
  payload: any;
  queue: string;
  tags?: string[];
  batchId?: string;
  batchName?: string;
  batchIndex?: number;
  workflowId?: string;
  workflowNodeId?: string;

  attempts: number;
  maxAttempts?: number;

  idempotencyKey?: string;

  state: JobState;

  // Priority (Phase 1.2)
  priority?: JobPriority;

  // Progress tracking (Phase 1.3) — 0–100, set during execution
  progress?: number;

  // Delayed/Scheduled job fields
  delayUntil?: number; // Timestamp in ms when job should be promoted
  scheduledCron?: string; // Cron pattern for recurring jobs
  lastScheduledAt?: number; // Last execution timestamp for recurring jobs
  repeatScheduleId?: string;
  repeatIntervalMs?: number;

  createdAt: number;
  updatedAt: number;
}

export interface CompletedJobRecord extends StoredJob {
  state: 'completed';
  completedAt: number;
  result?: any;
}

export type BatchJobState = 'pending' | 'completed' | 'failed';

export interface BatchJobRecord {
  id: string;
  name: string;
  queue: string;
  payload: any;
  state: BatchJobState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failedAt?: number;
  result?: any;
  error?: string;
}

export type BatchStatus = 'pending' | 'completed' | 'failed';

export interface BatchRecord {
  id: string;
  name: string;
  totalJobs: number;
  pendingJobs: number;
  completedJobs: number;
  failedJobs: number;
  progress: number;
  status: BatchStatus;
  createdAt: number;
  finishedAt?: number;
  jobs: BatchJobRecord[];
}

export type JobResolver = {
  resolve(jobName: string): any;
};

export type QueuePriority = 'high' | 'low';

export interface DispatchOptions {
  delayMs?: number; // Shorthand: delay in milliseconds
  delayUntil?: number; // Explicit: Unix timestamp in ms
  jobId?: string; // Custom job ID (defaults to UUID)
  idempotencyKey?: string; // For idempotent processing
  priority?: JobPriority; // Job priority (Phase 1.2)
  batchId?: string;
  batchName?: string;
  batchIndex?: number;
  workflowId?: string;
  workflowNodeId?: string;
}

export interface FlowNodeInput {
  id: string;
  job: Job;
  dependsOn?: string[];
}

export type FlowNodeStatus = 'pending' | 'queued' | 'completed' | 'failed' | 'blocked';

export interface FlowNodeState {
  id: string;
  jobName: string;
  queue: string;
  status: FlowNodeStatus;
  dependsOn: string[];
  children: string[];
  jobId?: string;
  error?: string;
}

export interface FlowState {
  id: string;
  atomicFailure: boolean;
  nodes: FlowNodeState[];
}

export interface ScheduleOptions {
  pattern?: string; // Cron pattern (e.g., '0 9 * * *' for daily at 9 AM)
  intervalMs?: number; // Repeat every N milliseconds
  runAt?: number; // One-time schedule at timestamp
  timezone?: string; // Timezone for cron (e.g., 'America/New_York')
  durable?: boolean; // Persist repeatable definition and recover on restart (default: true for interval/pattern)
}

export interface ScheduledJobHandle {
  id: string;
  stop(): void;
}

export interface RepeatableScheduleDefinition {
  id: string;
  queue: string;
  jobName: string;
  payload: any;
  pattern?: string;
  intervalMs?: number;
  timezone?: string;
  createdAt: number;
  updatedAt: number;
}

