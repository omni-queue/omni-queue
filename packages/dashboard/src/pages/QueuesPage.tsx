import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import type { OverviewResponse, QueueOverview } from '../types';

type Props = {
  queues: QueueOverview[];
  reliability?: OverviewResponse['reliability'];
};

type ReliabilityFilter = 'all' | 'open-circuit' | 'backpressured' | 'degraded';

function HealthDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`}
    />
  );
}

export function QueuesPage({ queues, reliability }: Props) {
  const [filter, setFilter] = useState<ReliabilityFilter>('all');

  if (queues.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        No queues registered yet.
      </div>
    );
  }

  const reliabilityByQueue = useMemo(
    () => new Map((reliability?.queues ?? []).map((entry) => [entry.queueName, entry])),
    [reliability]
  );

  const openCircuitCount = (reliability?.queues ?? []).filter((entry) => entry.circuitState === 'open').length;
  const backpressuredCount = (reliability?.queues ?? []).filter((entry) => entry.backpressureActive).length;
  const degradedCount = (reliability?.queues ?? []).filter(
    (entry) => entry.circuitState !== 'closed' || entry.backpressureActive
  ).length;

  const filteredQueues = queues.filter((queue) => {
    const queueReliability = reliabilityByQueue.get(queue.queue);
    if (filter === 'all') {
      return true;
    }

    if (!queueReliability) {
      return false;
    }

    if (filter === 'open-circuit') {
      return queueReliability.circuitState === 'open';
    }

    if (filter === 'backpressured') {
      return queueReliability.backpressureActive;
    }

    return queueReliability.circuitState !== 'closed' || queueReliability.backpressureActive;
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Queues</h2>
        <p className="text-slate-400 text-sm mt-1">{queues.length} queue{queues.length !== 1 ? 's' : ''} registered</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label={`All (${queues.length})`}
        />
        <FilterChip
          active={filter === 'open-circuit'}
          onClick={() => setFilter('open-circuit')}
          label={`Open circuit (${openCircuitCount})`}
        />
        <FilterChip
          active={filter === 'backpressured'}
          onClick={() => setFilter('backpressured')}
          label={`Backpressured (${backpressuredCount})`}
        />
        <FilterChip
          active={filter === 'degraded'}
          onClick={() => setFilter('degraded')}
          label={`Degraded (${degradedCount})`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filteredQueues.map((q) => {
          const queueReliability = reliabilityByQueue.get(q.queue);

          return (
            <Link
              key={q.queue}
              to={`/queues/${encodeURIComponent(q.queue)}`}
              className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-slate-800 text-sm truncate">{q.queue}</span>
                <HealthDot ok={q.dlqCount === 0} />
              </div>

              <div className="text-slate-400 text-xs truncate">{q.connection}</div>

              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-50">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-xl font-bold text-slate-900">{(q.load ?? q.depth).toLocaleString()}</span>
                  <span className="text-xs text-slate-400 uppercase font-medium">Load</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-xl font-bold text-slate-900">{q.deferredCount.toLocaleString()}</span>
                  <span className="text-xs text-slate-400 uppercase font-medium">Scheduled</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className={`text-xl font-bold ${q.dlqCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}
                  >
                    {q.dlqCount.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-400 uppercase font-medium">Failed</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 pt-1">
                <span>
                  Concurrency: <span className="font-semibold">{q.configuredConcurrency}</span>
                </span>
                {queueReliability && (
                  <>
                    <span className={`rounded-full px-2 py-0.5 ${queueReliability.circuitState === 'open' ? 'bg-red-100 text-red-700' : queueReliability.circuitState === 'half-open' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      circuit: {queueReliability.circuitState}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 ${queueReliability.backpressureActive ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      backpressure: {queueReliability.backpressureActive ? 'active' : 'clear'}
                    </span>
                  </>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {filteredQueues.length === 0 && (
        <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-6 text-sm text-slate-500">
          No queues match this reliability filter.
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
        active
          ? 'bg-slate-900 text-white border-slate-900'
          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
      }`}
    >
      {label}
    </button>
  );
}
