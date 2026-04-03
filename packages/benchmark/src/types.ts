/**
 * Shared types for all benchmark scenarios.
 */

export type LibraryName = 'vasto-memory' | 'vasto-redis' | 'bullmq' | 'bee-queue' | 'pg-boss';

export interface ScenarioResult {
  library: LibraryName;
  scenario: string;
  /** Warmup rounds excluded */
  iterations: number;
  /** Throughput in operations per second */
  ops?: number;
  /** Latency percentiles in milliseconds */
  latency?: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  /** Mean execution time in milliseconds */
  meanMs?: number;
  /** Peak RSS in megabytes */
  memoryMb?: number;
  /** Mean drift between scheduled and actual execution, in milliseconds */
  schedulerDriftMs?: number;
  meta?: Record<string, unknown>;
}

export interface ScenarioReport {
  scenario: string;
  runAt: string;
  nodeVersion: string;
  platform: string;
  results: ScenarioResult[];
}

export interface ScenarioModule {
  run(opts: ScenarioOptions): Promise<ScenarioReport>;
}

export interface ScenarioOptions {
  /** Number of warmup iterations to discard */
  warmupIterations?: number;
  /** Number of measured iterations */
  iterations?: number;
  /** Job concurrency for worker scenarios */
  concurrency?: number;
  /** Redis URL (defaults to REDIS_URL env; empty means Redis-backed scenarios are skipped) */
  redisUrl?: string;
  /** Postgres DSN (defaults to POSTGRES_URL env; empty means pg-boss scenarios are skipped) */
  postgresUrl?: string;
}
