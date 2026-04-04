import type { Supervisor } from '@vasto/core';

export async function buildOverview(supervisor: Supervisor) {
  const queueNames = supervisor.getQueueNames();
  const schedules = await supervisor.listRepeatableSchedules();
  const schedulesByQueue = schedules.reduce<Record<string, number>>((acc, schedule) => {
    acc[schedule.queue] = (acc[schedule.queue] ?? 0) + 1;
    return acc;
  }, {});

  const queueStats = await Promise.all(
    queueNames.map(async (queueName) => {
      const config = supervisor.getQueueConfig(queueName);
      const depth = await supervisor.getQueueDepth([queueName]);
      const deferred = await supervisor.queryDeferredJobs({ queueName, status: 'pending', limit: 1000 });
      const dlq = await supervisor.getDLQ({ queueName, limit: 1000 });
      const completed = await supervisor.getCompletedJobs({ queueName, limit: 1000 });
      const recentCompletionTimestamps = completed
        .map((job) => job.completedAt)
        .filter((value): value is number => Number.isFinite(value));
      const maxRuntimeMs = completed.reduce((max, job) => {
        const runtime = Math.max(0, job.completedAt - job.createdAt);
        return runtime > max ? runtime : max;
      }, 0);

      return {
        queue: queueName,
        connection: config?.connection,
        configuredConcurrency: config?.concurrency ?? 0,
        paused: supervisor.isQueuePaused(queueName),
        depth,
        load: depth,
        deferredCount: deferred.length,
        repeatableCount: schedulesByQueue[queueName] ?? 0,
        dlqCount: dlq.length,
        completedCount: completed.length,
        recentCompletionTimestamps,
        maxRuntimeMs,
      };
    })
  );

  const recentCompletionTimestamps = queueStats
    .flatMap((queue) => queue.recentCompletionTimestamps)
    .sort((left, right) => right - left)
    .slice(0, 10_000);

  const maxRuntimeMs = queueStats.reduce((max, queue) => {
    return queue.maxRuntimeMs > max ? queue.maxRuntimeMs : max;
  }, 0);

  const totals = queueStats.reduce(
    (acc, queue) => {
      acc.depth += queue.depth;
      acc.deferred += queue.deferredCount;
      acc.schedules += queue.repeatableCount;
      acc.dlq += queue.dlqCount;
      acc.completed += queue.completedCount;
      return acc;
    },
    { depth: 0, deferred: 0, schedules: 0, dlq: 0, completed: 0 }
  );

  const workers = supervisor.getWorkerDefinitions();
  const reliabilityGetter = (supervisor as Supervisor & {
    getReliabilitySnapshot?: () => {
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
  }).getReliabilitySnapshot;
  const reliability =
    typeof reliabilityGetter === 'function'
      ? reliabilityGetter.call(supervisor)
      : {
          openCircuits: 0,
          halfOpenCircuits: 0,
          backpressuredQueues: 0,
          queues: [],
        };

  return {
    status: 'ok',
    generatedAt: Date.now(),
    totals: {
      ...totals,
      load: totals.depth,
    },
    metrics: {
      recentCompletionTimestamps,
      maxRuntimeMs,
    },
    reliability,
    queues: queueStats.map(({ recentCompletionTimestamps: _recentCompletionTimestamps, maxRuntimeMs: _maxRuntimeMs, ...queue }) => queue),
    workers: {
      configured: Object.entries(workers).map(([name, def]) => ({
        name,
        queues: def.queues,
        concurrency: def.concurrency,
        isolation: def.isolation,
      })),
      desiredScaling: supervisor.getDesiredWorkerScaling(),
    },
  };
}
