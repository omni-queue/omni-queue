import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardFetch } from '../auth';
import type { OverviewResponse, WorkerDefinition } from '../types';
import { API_BASE } from '../types';

type Props = { overview: OverviewResponse | null; onRefresh: () => void };

function ScalingControl({
  worker,
  current,
  onChange,
}: {
  worker: WorkerDefinition;
  current: number;
  onChange: (name: string, n: number) => Promise<void>;
}) {
  const [val, setVal] = useState(current);
  const [saving, setSaving] = useState(false);
  const dirty = val !== current;

  const save = async () => {
    setSaving(true);
    try { await onChange(worker.name, val); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex flex-col gap-3 hover:shadow-md hover:border-slate-200 transition-all">
      <Link
        to={`/workers/${encodeURIComponent(worker.name)}`}
        className="flex items-start justify-between gap-2 group"
      >
        <div>
          <span className="font-mono font-semibold text-slate-800 text-sm group-hover:text-indigo-600 transition-colors">
            {worker.name}
          </span>
          <div className="text-xs text-slate-400 mt-0.5 group-hover:text-slate-500 transition-colors">
            {worker.isolation} · default concurrency: {worker.concurrency}
          </div>
        </div>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-50 text-indigo-700">
          live: {current}
        </span>
      </Link>

      <div className="text-xs text-slate-500">
        Queues:{' '}
        {worker.queues.map((q) => (
          <span key={q} className="inline-flex items-center rounded px-1.5 py-0.5 bg-slate-100 text-slate-600 mr-1 font-mono">
            {q}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-slate-50">
        <span className="text-sm text-slate-600 flex-1">Set concurrency:</span>
        <input
          type="number"
          min={0}
          max={100}
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
          className="w-20 text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          onClick={() => { void save(); }}
          disabled={!dirty || saving}
          className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}

export function WorkersPage({ overview, onRefresh }: Props) {
  if (!overview) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading workers…
      </div>
    );
  }

  const { configured, desiredScaling } = overview.workers;

  const handleScale = async (name: string, concurrency: number) => {
    const res = await dashboardFetch(`${API_BASE}/scaling`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workerName: name, concurrency }),
    });
    if (!res.ok) throw new Error(`Scaling failed: ${res.status}`);
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Workers</h2>
        <p className="text-slate-400 text-sm mt-1">
          {configured.length} worker{configured.length !== 1 ? 's' : ''} configured · adjust live concurrency below.
        </p>
      </div>

      {configured.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          No workers registered.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {configured.map((w) => (
            <ScalingControl
              key={w.name}
              worker={w}
              current={desiredScaling[w.name] ?? w.concurrency}
              onChange={handleScale}
            />
          ))}
        </div>
      )}
    </div>
  );
}
