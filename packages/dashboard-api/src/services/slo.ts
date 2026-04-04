import type { CompletedJobRecord, QueueLifecycleEvent, StoredJob, Supervisor } from '@vasto/core';

export type SloQueueSummary = {
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
  queues: SloQueueSummary[];
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

type RecoveryStat = {
  totalMs: number;
  count: number;
};

function deriveRecoveryStats(events: QueueLifecycleEvent[]): Map<string, RecoveryStat> {
  const sorted = [...events].sort((left, right) => left.timestamp - right.timestamp);
  const openIncidentTs = new Map<string, number>();
  const stats = new Map<string, RecoveryStat>();

  for (const event of sorted) {
    const queueName = event.queueName;
    if (!queueName) continue;

    if (event.type === 'job.failed' || event.type === 'job.deadlettered') {
      if (!openIncidentTs.has(queueName)) {
        openIncidentTs.set(queueName, event.timestamp);
      }
      continue;
    }

    if (event.type !== 'job.completed') {
      continue;
    }

    const startedAt = openIncidentTs.get(queueName);
    if (startedAt == null || event.timestamp < startedAt) {
      continue;
    }

    const delta = event.timestamp - startedAt;
    const current = stats.get(queueName) ?? { totalMs: 0, count: 0 };
    current.totalMs += delta;
    current.count += 1;
    stats.set(queueName, current);
    openIncidentTs.delete(queueName);
  }

  return stats;
}

function queueAllowed(queueName: string, allowedQueues?: Set<string>): boolean {
  if (!allowedQueues) return true;
  return allowedQueues.has(queueName);
}

export async function buildSloReport(
  supervisor: Supervisor,
  options: {
    windowMs: number;
    queueNames?: string[];
    allowedQueues?: Set<string>;
  }
): Promise<SloReport> {
  const now = Date.now();
  const windowMs = Math.max(60_000, options.windowMs);
  const cutoff = now - windowMs;
  const scopedQueues = options.queueNames ? new Set(options.queueNames) : null;

  const [completedRaw, failedRaw, lifecycleRaw] = await Promise.all([
    supervisor.getCompletedJobs({ limit: 5000, offset: 0 }),
    supervisor.getDLQ({ limit: 5000, offset: 0 }),
    Promise.resolve(supervisor.getRecentLifecycleEvents(5000)),
  ]);

  const completed = completedRaw.filter((job) => {
    if (!queueAllowed(job.queue, options.allowedQueues)) return false;
    if (scopedQueues && !scopedQueues.has(job.queue)) return false;
    return job.completedAt >= cutoff;
  });

  const failed = failedRaw.filter((job) => {
    if (!queueAllowed(job.queue, options.allowedQueues)) return false;
    if (scopedQueues && !scopedQueues.has(job.queue)) return false;
    return (job.updatedAt ?? job.createdAt) >= cutoff;
  });

  const lifecycle = lifecycleRaw.filter((event) => {
    if (event.timestamp < cutoff) return false;
    if (!event.queueName) return true;
    if (!queueAllowed(event.queueName, options.allowedQueues)) return false;
    if (scopedQueues && !scopedQueues.has(event.queueName)) return false;
    return true;
  });

  const perQueueCompleted = new Map<string, CompletedJobRecord[]>();
  for (const job of completed) {
    const list = perQueueCompleted.get(job.queue) ?? [];
    list.push(job);
    perQueueCompleted.set(job.queue, list);
  }

  const perQueueFailed = new Map<string, StoredJob[]>();
  for (const job of failed) {
    const list = perQueueFailed.get(job.queue) ?? [];
    list.push(job);
    perQueueFailed.set(job.queue, list);
  }

  const recoveryStats = deriveRecoveryStats(lifecycle);
  const queueNames = new Set<string>([
    ...perQueueCompleted.keys(),
    ...perQueueFailed.keys(),
    ...recoveryStats.keys(),
  ]);

  const queues: SloQueueSummary[] = Array.from(queueNames)
    .map((queueName) => {
      const completedJobs = perQueueCompleted.get(queueName) ?? [];
      const failedJobs = perQueueFailed.get(queueName) ?? [];
      const runtimes = completedJobs.map((job) => Math.max(0, job.completedAt - job.createdAt));
      const recovery = recoveryStats.get(queueName);
      const completedCount = completedJobs.length;
      const failedCount = failedJobs.length;
      const attempts = completedCount + failedCount;

      return {
        queueName,
        p95LatencyMs: percentile(runtimes, 95),
        successRatePct: attempts > 0 ? (completedCount / attempts) * 100 : 100,
        meanRecoveryMs: recovery && recovery.count > 0 ? recovery.totalMs / recovery.count : null,
        completed: completedCount,
        failed: failedCount,
        recoveredIncidents: recovery?.count ?? 0,
      };
    })
    .sort((left, right) => left.queueName.localeCompare(right.queueName));

  const overallRuntimes = completed.map((job) => Math.max(0, job.completedAt - job.createdAt));
  const overallCompleted = completed.length;
  const overallFailed = failed.length;
  const overallAttempts = overallCompleted + overallFailed;
  const totalRecoveryMs = queues.reduce((sum, queue) => {
    const mean = queue.meanRecoveryMs ?? 0;
    return sum + mean * queue.recoveredIncidents;
  }, 0);
  const totalRecoveryCount = queues.reduce((sum, queue) => sum + queue.recoveredIncidents, 0);

  return {
    generatedAt: now,
    windowMs,
    overall: {
      p95LatencyMs: percentile(overallRuntimes, 95),
      successRatePct: overallAttempts > 0 ? (overallCompleted / overallAttempts) * 100 : 100,
      meanRecoveryMs: totalRecoveryCount > 0 ? totalRecoveryMs / totalRecoveryCount : null,
      completed: overallCompleted,
      failed: overallFailed,
      recoveredIncidents: totalRecoveryCount,
    },
    queues,
  };
}
