import { BackOffType, QueuePriority } from '../types';
import { Plugin } from './plugin';
import { QueueRetryPolicyRule } from './retry-policy';

export interface QueueBackpressureConfig {
  depthThreshold: number;
  resumeThreshold?: number;
  checkIntervalMs?: number;
  mode?: 'delay' | 'pause';
}

export interface QueueCircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxInFlight?: number;
  tripOnTimeout?: boolean;
}

export interface QueuePoisonMessagePolicy {
  template?: 'quarantine' | 'auto-snooze' | 'escalation';
  maxFailures: number;
  snoozeMs?: number;
  escalationTag?: string;
}

export interface QueueSandboxConfig {
  enabled: boolean;
  envAllowlist?: string[] | undefined;
  cwdAllowlist?: string[] | undefined;
  networkAllowlist?: string[] | undefined;
  denyNetwork?: boolean | undefined;
  denyChildProcessSpawn?: boolean | undefined;
  readOnlyFilesystem?: boolean | undefined;
}

export interface QueueReliabilityConfig {
  backpressure?: QueueBackpressureConfig;
  circuitBreaker?: QueueCircuitBreakerConfig;
  poisonPolicy?: QueuePoisonMessagePolicy;
}

export type RetryBackoffStrategyName =
  | 'fixed'
  | 'exponential'
  | 'full-jitter'
  | 'equal-jitter'
  | 'decorrelated-jitter';

export interface QueueConfig {
  name: string;

  priority?: QueuePriority;

  connection: string;

  concurrency: number;
  batchSize: number;

  visibilityTimeout?: number;

  // Per-job execution timeout in milliseconds (Phase 3.3)
  executionTimeoutMs?: number;

  // Timeout handling mode:
  // - retry: treat timeout like a regular failure and retry until attempts exhausted
  // - fail: move to dead-letter immediately on timeout
  timeoutStrategy?: 'retry' | 'fail';

  // Signal used to terminate process-isolated workers when timeout occurs
  timeoutSignal?: NodeJS.Signals;

  // Maximum attempts before moving to dead-letter queue (Phase 1.4)
  maxAttempts?: number;

  retry?: {
    attempts: number;
    maxAttempts: number;
    backoff: BackOffType;
    delay?: number;
    strategyName?: RetryBackoffStrategyName;
    jitter?: number;
    maxDelay?: number;
    policy?: QueueRetryPolicyRule[];
  };

  rateLimit?: {
    capacity: number;
    refillRate: number;
    perConsumer?: {
      capacity: number;
      refillRate: number;
    };
  };

  // Idempotency and deduplication policy (Phase 4.4)
  idempotency?: {
    // Prevent duplicate dispatches with the same idempotency key if a matching
    // completed/failed job exists within this window.
    dedupeWindowMs?: number;

    // Include dead-lettered jobs in dedupe window checks.
    includeFailed?: boolean;
  };

  // Reliability hardening strategy (Phase 5.1)
  reliability?: QueueReliabilityConfig;

  // Strict sandbox controls for process-isolated workers (Phase 5.5)
  sandbox?: QueueSandboxConfig;

  plugins?: Plugin[];
}

export function defineQueues(configs: Record<string, QueueConfig>) {
  return configs;
}
