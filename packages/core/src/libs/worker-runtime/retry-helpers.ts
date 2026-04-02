import type { ExecutionContext, StoredJob } from '../../types';
import type { QueueConfig } from '../../interfaces/queue-config';
import type { QueueRetryPolicyRule, RetryDecision, RetryDecisionContext } from '../../interfaces/retry-policy';
import type { WorkerConfig } from '../../interfaces/worker-config';
import type { ResolvedRetryDecision } from './internal-types';

export function toExecutionError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export function toErrorDetails(error: Error): NonNullable<StoredJob['errorDetails']> {
  const details: NonNullable<StoredJob['errorDetails']> = {
    error: error.message,
    ...(error.name ? { errorName: error.name } : {}),
    ...(typeof (error as Error & { code?: unknown }).code === 'string'
      ? { errorCode: (error as Error & { code?: string }).code }
      : {}),
    ...(typeof error.stack === 'string' ? { errorStack: error.stack } : {}),
  };

  return details;
}

export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'JobTimeoutError' || /timeout/i.test(error.message);
}

export function resolveConfiguredMaxAttempts(
  queueConfig: QueueConfig,
  instance: { retries?: () => number }
): number {
  return Math.max(
    1,
    queueConfig.maxAttempts ??
      instance.retries?.() ??
      queueConfig.retry?.maxAttempts ??
      queueConfig.retry?.attempts ??
      3
  );
}

export function resolveExecutionTimeoutMs(queueConfig: QueueConfig, workerConfig: WorkerConfig): number {
  if (queueConfig.executionTimeoutMs && queueConfig.executionTimeoutMs > 0) {
    return queueConfig.executionTimeoutMs;
  }

  if (workerConfig.timeout && workerConfig.timeout > 0) {
    return workerConfig.timeout;
  }

  return 30000;
}

export function matchesRetryRule(rule: QueueRetryPolicyRule, context: RetryDecisionContext): boolean {
  const match = rule.when;

  if (match.timeout !== undefined && match.timeout !== context.isTimeout) {
    return false;
  }

  if (match.name && match.name !== context.errorName) {
    return false;
  }

  if (match.code && match.code !== context.errorCode) {
    return false;
  }

  if (
    match.messageIncludes &&
    !context.errorMessage.toLowerCase().includes(match.messageIncludes.toLowerCase())
  ) {
    return false;
  }

  return true;
}

export function matchQueueRetryPolicy(
  queueConfig: QueueConfig,
  context: RetryDecisionContext
): RetryDecision | undefined {
  const rules = queueConfig.retry?.policy ?? [];
  const matched = rules.find((rule) => matchesRetryRule(rule, context));

  if (!matched) {
    return undefined;
  }

  return {
    action: matched.action,
    ...(matched.maxAttempts !== undefined ? { maxAttempts: matched.maxAttempts } : {}),
    ...(matched.backoffMs !== undefined ? { backoffMs: matched.backoffMs } : {}),
  };
}

export function resolveRetryDecision(
  ctx: ExecutionContext,
  queueConfig: QueueConfig,
  error: unknown,
  attempt: number,
  configuredMaxAttempts: number
): ResolvedRetryDecision {
  const normalizedError = toExecutionError(error);
  const context: RetryDecisionContext = {
    attempt,
    maxAttempts: configuredMaxAttempts,
    queueName: ctx.job.queue,
    jobId: ctx.job.id,
    isTimeout: isTimeoutError(normalizedError),
    ...(normalizedError.name ? { errorName: normalizedError.name } : {}),
    ...(typeof (normalizedError as Error & { code?: string }).code === 'string'
      ? { errorCode: (normalizedError as Error & { code?: string }).code }
      : {}),
    errorMessage: normalizedError.message,
  };

  const jobDecision = ctx.instance.retryPolicy?.(normalizedError, context);
  const queueDecision = jobDecision ?? matchQueueRetryPolicy(queueConfig, context);
  const resolved = queueDecision ?? { action: 'retry' as const };

  return {
    action: resolved.action,
    maxAttempts: Math.max(1, resolved.maxAttempts ?? configuredMaxAttempts),
    ...(resolved.backoffMs !== undefined ? { backoffMs: resolved.backoffMs } : {}),
  };
}

export function resolveRetryBackoff(
  ctx: ExecutionContext,
  queueConfig: QueueConfig,
  attempt: number,
  decision: ResolvedRetryDecision,
  previousBackoff: number,
  resolveBackoff: (queueConfig: QueueConfig, attempt: number, previousBackoff?: number) => number
): number {
  if (decision.backoffMs !== undefined) {
    return Math.max(0, decision.backoffMs);
  }

  return ctx.instance.backoff?.(attempt) ?? resolveBackoff(queueConfig, attempt, previousBackoff);
}
