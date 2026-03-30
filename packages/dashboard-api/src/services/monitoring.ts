import type { CompletedJobRecord, StoredJob, Supervisor } from '@omni-queue/core';

export type MonitoringTagSummary = {
  tag: string;
  ready: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
  lastSeenAt?: number;
};

function updateSummary(
  summaries: Map<string, MonitoringTagSummary>,
  jobs: Array<StoredJob | CompletedJobRecord>,
  field: 'ready' | 'active' | 'completed' | 'failed'
): void {
  for (const job of jobs) {
    for (const tag of job.tags ?? []) {
      const current = summaries.get(tag) ?? {
        tag,
        ready: 0,
        active: 0,
        completed: 0,
        failed: 0,
        total: 0,
      };

      current[field] += 1;
      current.total += 1;
      const observedAt = 'completedAt' in job ? (job.completedAt ?? job.updatedAt) : job.updatedAt;
      current.lastSeenAt = Math.max(current.lastSeenAt ?? 0, observedAt);
      summaries.set(tag, current);
    }
  }
}

function filterByQueues<T extends { queue: string }>(jobs: T[], queueSet?: Set<string>): T[] {
  if (!queueSet) {
    return jobs;
  }

  return jobs.filter((job) => queueSet.has(job.queue));
}

export async function listMonitoringTags(
  supervisor: Supervisor,
  options: {
    queueNames?: string[];
  } = {}
): Promise<MonitoringTagSummary[]> {
  const queueSet = options.queueNames ? new Set(options.queueNames) : undefined;
  const [ready, active, completed, failed] = await Promise.all([
    supervisor.getReadyJobs(),
    supervisor.getActiveJobs(),
    supervisor.getCompletedJobs(),
    supervisor.getDLQ(),
  ]);

  const summaries = new Map<string, MonitoringTagSummary>();
  updateSummary(summaries, filterByQueues(ready, queueSet), 'ready');
  updateSummary(summaries, filterByQueues(active, queueSet), 'active');
  updateSummary(summaries, filterByQueues(completed, queueSet), 'completed');
  updateSummary(summaries, filterByQueues(failed, queueSet), 'failed');

  return Array.from(summaries.values()).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.tag.localeCompare(b.tag);
  });
}

export async function getMonitoringTag(
  supervisor: Supervisor,
  tag: string,
  options: {
    queueNames?: string[];
  } = {}
): Promise<MonitoringTagSummary | null> {
  const summaries = await listMonitoringTags(supervisor, options);
  return summaries.find((item) => item.tag === tag) ?? null;
}