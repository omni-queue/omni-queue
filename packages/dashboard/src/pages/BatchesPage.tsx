import { useCallback, useEffect, useMemo, useState } from 'react';
import { dashboardFetch } from '../auth';
import type { BatchRow } from '../types';
import { API_BASE } from '../types';

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function payloadPreview(payload: unknown): string {
  if (payload == null) return '—';
  if (typeof payload === 'string') return payload;

  try {
    return JSON.stringify(payload);
  } catch {
    return '[unserializable payload]';
  }
}

export function BatchesPage() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardFetch(`${API_BASE}/batches?limit=200`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const payload = (await res.json()) as { batches: BatchRow[] };
      const nextBatches = payload.batches ?? [];
      setBatches(nextBatches);
      setSelectedBatchId((current) => current ?? nextBatches[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load batches');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  );

  const retryFailed = useCallback(async () => {
    if (!selected) return;
    setRetrying(true);
    setError(null);
    try {
      const res = await dashboardFetch(`${API_BASE}/batches/${encodeURIComponent(selected.id)}/retry-failed`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to retry failed batch jobs');
    } finally {
      setRetrying(false);
    }
  }, [load, selected]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Batches</h2>
          <p className="text-slate-400 text-sm mt-1">Run grouped jobs as a tracked unit with completion, failure, and retry visibility.</p>
        </div>
        <button
          onClick={() => {
            void load();
          }}
          className="px-4 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Batch List</h3>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading…</div>
          ) : batches.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">No batches yet.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {batches.map((batch) => (
                <button
                  key={batch.id}
                  onClick={() => setSelectedBatchId(batch.id)}
                  className={`w-full text-left px-5 py-4 transition-colors ${selectedBatchId === batch.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{batch.name}</div>
                      <div className="text-xs text-slate-400 font-mono truncate mt-1">{batch.id}</div>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${batch.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : batch.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                      {batch.status}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>{batch.completedJobs}/{batch.totalJobs} done</span>
                    <span>{batch.progress}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${batch.status === 'failed' ? 'bg-red-500' : batch.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${Math.max(batch.progress, 2)}%` }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Batch Detail</h3>
            {selected && selected.failedJobs > 0 && (
              <button
                onClick={() => {
                  void retryFailed();
                }}
                disabled={retrying}
                className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-40 transition-colors"
              >
                {retrying ? 'Retrying…' : 'Retry failed jobs'}
              </button>
            )}
          </div>
          {!selected ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Select a batch to inspect it.</div>
          ) : (
            <div className="flex flex-col gap-5 p-5">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Total" value={selected.totalJobs} />
                <Stat label="Pending" value={selected.pendingJobs} />
                <Stat label="Completed" value={selected.completedJobs} />
                <Stat label="Failed" value={selected.failedJobs} />
              </div>
              <div className="text-xs text-slate-500">
                <div>Created {relativeTime(selected.createdAt)}</div>
                <div>{selected.finishedAt ? `Finished ${relativeTime(selected.finishedAt)}` : 'Still running'}</div>
              </div>
              <div className="border border-slate-100 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400 text-xs uppercase font-semibold bg-slate-50">
                      <th className="px-4 py-3">Job</th>
                      <th className="px-4 py-3">Payload</th>
                      <th className="px-4 py-3">Queue</th>
                      <th className="px-4 py-3">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {selected.jobs.map((job) => (
                      <tr key={job.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{job.name}</div>
                          <div className="text-xs text-slate-400 font-mono truncate max-w-[180px]">{job.id}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-[220px] truncate" title={payloadPreview(job.payload)}>{payloadPreview(job.payload)}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{job.queue}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${job.state === 'completed' ? 'bg-emerald-50 text-emerald-700' : job.state === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                            {job.state}
                          </span>
                          {job.error && <div className="mt-1 text-xs text-red-600 truncate" title={job.error}>{job.error}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
      <div className="text-xs uppercase font-medium text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}