import type { CompletedJobRecord, StoredJob, Supervisor } from '@vasto/core';

export type DashboardJobFilterStatus = 'dlq' | 'pending-deferred' | 'promoted-deferred' | 'deferred' | 'ready' | 'active' | 'completed';
export type DashboardJobSource = 'dlq' | 'pending-deferred' | 'promoted-deferred' | 'ready' | 'active' | 'completed';

export type DashboardJobQuery = {
  queueName?: string;
  status?: DashboardJobFilterStatus;
  limit?: number;
  offset?: number;
};

function getSilencedJobNames(supervisor: Supervisor): Set<string> {
  return new Set(supervisor.getDashboardOptions()?.silencedJobs ?? []);
}

function paginateJobs<T>(jobs: T[], limit?: number, offset?: number): T[] {
  const start = Number.isFinite(offset) ? (offset as number) : 0;
  const end = Number.isFinite(limit) ? start + (limit as number) : undefined;
  return jobs.slice(start, end);
}

export async function getSilencedJobs(supervisor: Supervisor, query: DashboardJobQuery) {
  const { queueName, limit, offset } = query;
  const silencedNames = getSilencedJobNames(supervisor);
  const jobs = await supervisor.getCompletedJobs({
    ...(queueName ? { queueName } : {}),
  });

  const filtered = jobs.filter((job) => silencedNames.has(job.name));
  return { mode: 'completed' as const, jobs: paginateJobs(filtered, limit, offset) };
}

export async function getDashboardJobs(supervisor: Supervisor, query: DashboardJobQuery) {
  const { queueName, status, limit, offset } = query;

  if (!status) {
    const pageSize = Number.isFinite(limit) ? (limit as number) : 100;
    const pageOffset = Number.isFinite(offset) ? (offset as number) : 0;
    const sourceLimit = Math.max(500, pageSize + pageOffset);
    const silencedNames = getSilencedJobNames(supervisor);

    const [dlq, ready, active, deferred, completedRaw] = await Promise.all([
      supervisor.getDLQ({
        ...(queueName ? { queueName } : {}),
        limit: sourceLimit,
        offset: 0,
      }),
      supervisor.getReadyJobs({
        ...(queueName ? { queueName } : {}),
        limit: sourceLimit,
        offset: 0,
      }),
      supervisor.getActiveJobs({
        ...(queueName ? { queueName } : {}),
        limit: sourceLimit,
        offset: 0,
      }),
      supervisor.queryDeferredJobs({
        ...(queueName ? { queueName } : {}),
        limit: sourceLimit,
        offset: 0,
      }),
      supervisor.getCompletedJobs({
        ...(queueName ? { queueName } : {}),
        limit: sourceLimit,
        offset: 0,
      }),
    ]);

    const completed = completedRaw.filter((job) => !silencedNames.has(job.name));
    const merged = [...active, ...ready, ...deferred, ...dlq, ...completed];
    merged.sort((left, right) => {
      const leftTs = left.updatedAt ?? left.createdAt;
      const rightTs = right.updatedAt ?? right.createdAt;
      return rightTs - leftTs;
    });

    const deduped = new Map<string, (typeof merged)[number]>();
    for (const job of merged) {
      const key = `${job.queue}:${job.id}`;
      if (!deduped.has(key)) {
        deduped.set(key, job);
      }
    }

    return { mode: 'all' as const, jobs: paginateJobs(Array.from(deduped.values()), limit, offset) };
  }

  if (status === 'dlq') {
    const jobs = await supervisor.getDLQ({
      ...(queueName ? { queueName } : {}),
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(Number.isFinite(offset) ? { offset } : {}),
    });

    return { mode: 'dlq' as const, jobs };
  }

  if (status === 'ready') {
    const jobs = await supervisor.getReadyJobs({
      ...(queueName ? { queueName } : {}),
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(Number.isFinite(offset) ? { offset } : {}),
    });

    return { mode: 'ready' as const, jobs };
  }

  if (status === 'active') {
    const jobs = await supervisor.getActiveJobs({
      ...(queueName ? { queueName } : {}),
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(Number.isFinite(offset) ? { offset } : {}),
    });

    return { mode: 'active' as const, jobs };
  }

  if (status === 'completed') {
    const silencedNames = getSilencedJobNames(supervisor);
    const jobs = await supervisor.getCompletedJobs({
      ...(queueName ? { queueName } : {}),
    });

    const filtered = jobs.filter((job) => !silencedNames.has(job.name));

    return { mode: 'completed' as const, jobs: paginateJobs(filtered, limit, offset) };
  }

  const deferredStatus =
    status === 'pending-deferred' ? 'pending' : status === 'promoted-deferred' ? 'promoted' : undefined;

  const jobs = await supervisor.queryDeferredJobs({
    ...(queueName ? { queueName } : {}),
    ...(deferredStatus ? { status: deferredStatus } : {}),
    ...(Number.isFinite(limit) ? { limit } : {}),
    ...(Number.isFinite(offset) ? { offset } : {}),
  });

  return {
    mode: (deferredStatus ? `${deferredStatus}-deferred` : 'deferred') as 'pending-deferred' | 'promoted-deferred' | 'deferred',
    jobs,
  };
}

export async function getDashboardJobById(
  supervisor: Supervisor,
  jobId: string,
  queueName?: string
): Promise<{ source: DashboardJobSource; job: StoredJob | CompletedJobRecord } | null> {
  const completed = await supervisor.getCompletedJobs({ ...(queueName ? { queueName } : {}), limit: 5000 });
  const completedMatch = completed.find((job) => job.id === jobId);
  if (completedMatch) return { source: 'completed', job: completedMatch };

  const ready = await supervisor.getReadyJobs({ ...(queueName ? { queueName } : {}), limit: 5000 });
  const readyMatch = ready.find((job) => job.id === jobId);
  if (readyMatch) return { source: 'ready', job: readyMatch };

  const active = await supervisor.getActiveJobs({ ...(queueName ? { queueName } : {}), limit: 5000 });
  const activeMatch = active.find((job) => job.id === jobId);
  if (activeMatch) return { source: 'active', job: activeMatch };

  const pending = await supervisor.queryDeferredJobs({ ...(queueName ? { queueName } : {}), status: 'pending', limit: 5000 });
  const pendingMatch = pending.find((job) => job.id === jobId);
  if (pendingMatch) return { source: 'pending-deferred', job: pendingMatch };

  const promoted = await supervisor.queryDeferredJobs({ ...(queueName ? { queueName } : {}), status: 'promoted', limit: 5000 });
  const promotedMatch = promoted.find((job) => job.id === jobId);
  if (promotedMatch) return { source: 'promoted-deferred', job: promotedMatch };

  const dlq = await supervisor.getDLQ({ ...(queueName ? { queueName } : {}), limit: 5000 });
  const dlqMatch = dlq.find((job) => job.id === jobId);
  if (dlqMatch) return { source: 'dlq', job: dlqMatch };

  return null;
}
