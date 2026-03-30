export type QueueOverview = {
  queue: string;
  connection: string;
  configuredConcurrency: number;
  paused?: boolean;
  depth: number;
  load?: number;
  deferredCount: number;
  dlqCount: number;
  completedCount?: number;
};

export type WorkerDefinition = {
  name: string;
  queues: string[];
  concurrency: number;
  isolation: string;
};

export type OverviewResponse = {
  status: string;
  generatedAt: number;
  totals: { depth: number; load?: number; deferred: number; dlq: number; completed: number };
  metrics?: {
    recentCompletionTimestamps: number[];
    maxRuntimeMs: number;
  };
  reliability?: {
    openCircuits: number;
    halfOpenCircuits: number;
    backpressuredQueues: number;
    queues: Array<{
      queueName: string;
      backpressureActive: boolean;
      circuitState: 'closed' | 'open' | 'half-open';
      updatedAt: number;
    }>;
  };
  queues: QueueOverview[];
  workers: {
    configured: WorkerDefinition[];
    desiredScaling: Record<string, number>;
  };
};

export type JobRow = {
  id: string;
  name: string;
  queue: string;
  state: string;
  tags?: string[];
  payload?: unknown;
  result?: unknown;
  batchId?: string;
  batchName?: string;
  batchIndex?: number;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  delayUntil?: number;
  progress?: number;
};

export type BatchJobRow = {
  id: string;
  name: string;
  queue: string;
  payload?: unknown;
  state: 'pending' | 'completed' | 'failed';
  attempts: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failedAt?: number;
  result?: unknown;
  error?: string;
};

export type BatchRow = {
  id: string;
  name: string;
  totalJobs: number;
  pendingJobs: number;
  completedJobs: number;
  failedJobs: number;
  progress: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: number;
  finishedAt?: number;
  jobs: BatchJobRow[];
};

export type MonitoringTagRow = {
  tag: string;
  ready: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
  lastSeenAt?: number;
};

export type SloQueueRow = {
  queueName: string;
  p95LatencyMs: number;
  successRatePct: number;
  meanRecoveryMs: number | null;
  completed: number;
  failed: number;
  recoveredIncidents: number;
};

export type SloReport = {
  generatedAt: number;
  windowMs: number;
  overall: {
    p95LatencyMs: number;
    successRatePct: number;
    meanRecoveryMs: number | null;
    completed: number;
    failed: number;
    recoveredIncidents: number;
  };
  queues: SloQueueRow[];
};

export type WsMessage =
  | { type: 'overview'; data: OverviewResponse }
  | { type: string; data: unknown };

export const API_BASE: string =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_DASHBOARD_ENDPOINT ?? '/api/dashboard';
