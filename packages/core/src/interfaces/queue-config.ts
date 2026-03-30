import { BackOffType, QueuePriority } from '../types';
import { Plugin } from './plugin';

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

export interface QueueReliabilityConfig {
  backpressure?: QueueBackpressureConfig;
  circuitBreaker?: QueueCircuitBreakerConfig;
  poisonPolicy?: QueuePoisonMessagePolicy;
}

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
  };

  rateLimit?: {
    capacity: number;
    refillRate: number;
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

  plugins?: Plugin[];
}

export function defineQueues(configs: Record<string, QueueConfig>) {
  return configs;
}
