import type { OverviewResponse } from '../types';
import type { WsStatus } from '../hooks/useWebSocket';

type Sample = {
  ts: number;
  depth: number;
  deferred: number;
  dlq: number;
  completed: number;
  recentCompletionTimestamps: number[];
};

type Props = {
  samples: Sample[];
  overview: OverviewResponse | null;
  wsStatus: WsStatus;
};

function formatWaitMinutes(waitMinutes: number | null): string {
  if (waitMinutes == null || !Number.isFinite(waitMinutes)) {
    return '-';
  }

  if (waitMinutes <= 0.15) {
    return 'A few seconds';
  }

  if (waitMinutes < 1) {
    return `${Math.round(waitMinutes * 60)}s`;
  }

  if (waitMinutes < 60) {
    return `${waitMinutes.toFixed(1)}m`;
  }

  const hours = waitMinutes / 60;
  return `${hours.toFixed(1)}h`;
}

function getBaselineSample(samples: Sample[], targetTs: number): Sample | null {
  if (samples.length === 0) {
    return null;
  }

  let baseline: Sample | null = null;
  for (const sample of samples) {
    if (sample.ts <= targetTs) {
      baseline = sample;
      continue;
    }

    break;
  }

  return baseline ?? samples[0] ?? null;
}

function estimateThroughputPerMinute(samples: Sample[], windowMs: number): number {
  const latest = samples[samples.length - 1];
  if (!latest) {
    return 0;
  }

  if (latest.recentCompletionTimestamps.length > 0) {
    const cutoff = latest.ts - windowMs;
    const inWindow = latest.recentCompletionTimestamps.reduce((count, completedAt) => {
      if (completedAt >= cutoff && completedAt <= latest.ts) {
        return count + 1;
      }
      return count;
    }, 0);

    const minutes = windowMs / 60_000;
    if (minutes <= 0) {
      return 0;
    }

    return inWindow / minutes;
  }

  if (samples.length < 2) {
    return 0;
  }

  const baseline = getBaselineSample(samples, latest.ts - windowMs);
  if (!baseline || latest.ts <= baseline.ts) {
    return 0;
  }

  const completedDelta = Math.max(0, latest.completed - baseline.completed);
  const minutes = (latest.ts - baseline.ts) / 60_000;
  if (minutes <= 0) {
    return 0;
  }

  return completedDelta / minutes;
}

function maxObservedThroughputPerMinute(samples: Sample[]): number {
  const latest = samples[samples.length - 1];
  if (latest && latest.recentCompletionTimestamps.length > 0) {
    const cutoff = latest.ts - 60 * 60_000;
    const buckets = new Map<number, number>();

    for (const completedAt of latest.recentCompletionTimestamps) {
      if (completedAt < cutoff || completedAt > latest.ts) {
        continue;
      }

      const minuteBucket = Math.floor(completedAt / 60_000);
      buckets.set(minuteBucket, (buckets.get(minuteBucket) ?? 0) + 1);
    }

    let max = 0;
    for (const value of buckets.values()) {
      if (value > max) {
        max = value;
      }
    }

    return max;
  }

  if (samples.length < 2) {
    return 0;
  }

  let max = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current || current.ts <= previous.ts) {
      continue;
    }

    const completedDelta = Math.max(0, current.completed - previous.completed);
    const perMinute = (completedDelta / (current.ts - previous.ts)) * 60_000;
    if (perMinute > max) {
      max = perMinute;
    }
  }

  return max;
}

function formatRuntimeMs(runtimeMs: number | null): string {
  if (runtimeMs == null || !Number.isFinite(runtimeMs) || runtimeMs <= 0) {
    return '-';
  }

  if (runtimeMs < 1_000) {
    return `${Math.round(runtimeMs)}ms`;
  }

  const seconds = runtimeMs / 1_000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  }

  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

export function MetricsPage({ samples, overview, wsStatus }: Props) {
  if (!overview) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading metrics…
      </div>
    );
  }

  const jobsPerMinute = estimateThroughputPerMinute(samples, 60_000);
  const jobsPastHour = Math.round(estimateThroughputPerMinute(samples, 60 * 60_000) * 60);
  const maxThroughput = maxObservedThroughputPerMinute(samples);
  const maxRuntimeMs = overview.metrics?.maxRuntimeMs ?? null;
  const openCircuits = overview.reliability?.openCircuits ?? 0;
  const backpressuredQueues = overview.reliability?.backpressuredQueues ?? 0;

  const desiredScaling = overview.workers.desiredScaling;
  const totalProcesses = Object.values(desiredScaling).reduce((sum, value) => sum + value, 0);
  const throughputForWait = Math.max(jobsPerMinute, 0);

  const processesByQueue = new Map<string, number>();
  for (const worker of overview.workers.configured) {
    const processCount = desiredScaling[worker.name] ?? worker.concurrency;
    for (const queue of worker.queues) {
      processesByQueue.set(queue, (processesByQueue.get(queue) ?? 0) + processCount);
    }
  }

  const waitByQueue = overview.queues.map((queue) => {
    if (throughputForWait <= 0) {
      return { queue: queue.queue, waitMinutes: queue.depth > 0 ? null : 0 };
    }

    return {
      queue: queue.queue,
      waitMinutes: queue.depth / throughputForWait,
    };
  });

  const maxWaitMinutes = waitByQueue.reduce<number | null>((max, entry) => {
    if (entry.waitMinutes == null) {
      return max;
    }
    if (max == null) {
      return entry.waitMinutes;
    }
    return Math.max(max, entry.waitMinutes);
  }, null);

  const wsLive = wsStatus === 'connected';
  const statusLabel = wsLive ? 'Active' : wsStatus === 'connecting' ? 'Connecting' : 'Polling';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Metrics</h2>
        <p className="text-slate-400 text-sm mt-1">Horizon-style operational summary from live queue telemetry</p>
      </div>

      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Overview</h3>
        </div>
        <div className="grid gap-0 sm:grid-cols-2 xl:grid-cols-4">
          <div className="px-6 py-5 border-b sm:border-r border-slate-100">
            <div className="text-xs text-slate-400 uppercase font-semibold">Jobs Per Minute</div>
            <div className="text-3xl font-bold text-slate-900 mt-1">{Math.round(jobsPerMinute).toLocaleString()}</div>
          </div>
          <div className="px-6 py-5 border-b xl:border-r border-slate-100">
            <div className="text-xs text-slate-400 uppercase font-semibold">Jobs Past Hour</div>
            <div className="text-3xl font-bold text-slate-900 mt-1">{jobsPastHour.toLocaleString()}</div>
          </div>
          <div className="px-6 py-5 border-b sm:border-r border-slate-100">
            <div className="text-xs text-slate-400 uppercase font-semibold">Failed Jobs</div>
            <div className="text-3xl font-bold mt-1 text-red-600">{overview.totals.dlq.toLocaleString()}</div>
          </div>
          <div className="px-6 py-5 border-b border-slate-100">
            <div className="text-xs text-slate-400 uppercase font-semibold">Status</div>
            <div className={`text-2xl font-bold mt-1 ${wsLive ? 'text-emerald-600' : 'text-amber-600'}`}>{statusLabel}</div>
            <div className="text-xs text-slate-500 mt-1">{openCircuits} open circuits · {backpressuredQueues} backpressured</div>
          </div>

          <div className="px-6 py-5 sm:border-r border-slate-100">
            <div className="text-xs text-slate-400 uppercase font-semibold">Total Processes</div>
            <div className="text-3xl font-bold text-slate-900 mt-1">{totalProcesses.toLocaleString()}</div>
          </div>
          <div className="px-6 py-5 xl:border-r border-slate-100">
            <div className="text-xs text-slate-400 uppercase font-semibold">Max Wait Time</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{formatWaitMinutes(maxWaitMinutes)}</div>
          </div>
          <div className="px-6 py-5 sm:border-r border-slate-100">
            <div className="text-xs text-slate-400 uppercase font-semibold">Max Runtime</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{formatRuntimeMs(maxRuntimeMs)}</div>
          </div>
          <div className="px-6 py-5">
            <div className="text-xs text-slate-400 uppercase font-semibold">Max Throughput</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{Math.round(maxThroughput).toLocaleString()}/min</div>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Current Workload</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs uppercase font-semibold bg-slate-50">
              <th className="px-6 py-3">Queue</th>
              <th className="px-6 py-3 text-right">Jobs</th>
              <th className="px-6 py-3 text-right">Processes</th>
              <th className="px-6 py-3 text-right">Wait</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {overview.queues.map((queue) => {
              const waitMinutes = waitByQueue.find((entry) => entry.queue === queue.queue)?.waitMinutes ?? 0;
              const wait = waitMinutes == null ? 'Backlogged' : formatWaitMinutes(waitMinutes);

              return (
                <tr key={queue.queue} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-3 font-mono font-medium text-slate-800">{queue.queue}</td>
                  <td className="px-6 py-3 text-right text-slate-700">{(queue.load ?? queue.depth).toLocaleString()}</td>
                  <td className="px-6 py-3 text-right text-slate-700">{(processesByQueue.get(queue.queue) ?? queue.configuredConcurrency).toLocaleString()}</td>
                  <td className="px-6 py-3 text-right text-slate-700">{wait}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Supervisors</h3>
          <span className="text-xs text-slate-400">{window.location.hostname || 'localhost'}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs uppercase font-semibold bg-slate-50">
              <th className="px-6 py-3">Supervisor</th>
              <th className="px-6 py-3">Queues</th>
              <th className="px-6 py-3 text-right">Processes</th>
              <th className="px-6 py-3 text-right">Balancing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {overview.workers.configured.map((worker) => (
              <tr key={worker.name} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-3 font-medium text-slate-900">{worker.name}</td>
                <td className="px-6 py-3 text-slate-700">{worker.queues.join(', ')}</td>
                <td className="px-6 py-3 text-right text-slate-700">{(desiredScaling[worker.name] ?? worker.concurrency).toLocaleString()}</td>
                <td className="px-6 py-3 text-right text-slate-700">Auto</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// helper used by App to build a Sample from OverviewResponse
export function overviewToSample(o: OverviewResponse): Sample {
  return {
    ts: o.generatedAt,
    depth: o.totals.depth,
    deferred: o.totals.deferred,
    dlq: o.totals.dlq,
    completed: o.totals.completed,
    recentCompletionTimestamps: o.metrics?.recentCompletionTimestamps ?? [],
  };
}
