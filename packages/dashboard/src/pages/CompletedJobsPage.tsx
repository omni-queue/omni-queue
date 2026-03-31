import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardFetch } from '../auth';
import type { JobRow, QueueOverview } from '../types';
import { API_BASE } from '../types';

type Props = { queues: QueueOverview[] };

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

export function CompletedJobsPage({ queues }: Props) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [queueFilter, setQueueFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (queueFilter !== 'all') params.set('queue', queueFilter);
      const res = await dashboardFetch(`${API_BASE}/processed?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const payload = (await res.json()) as { jobs: JobRow[] };
      setJobs(payload.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load completed jobs');
    } finally {
      setLoading(false);
    }
  }, [queueFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Completed Jobs</h2>
          <p className="text-slate-400 text-sm mt-1">Recently processed jobs, similar to Horizon completed history.</p>
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

      <div className="flex gap-3">
        <select
          value={queueFilter}
          onChange={(e) => setQueueFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="all">All queues</option>
          {queues.map((q) => (
            <option key={q.queue} value={q.queue}>{q.queue}</option>
          ))}
        </select>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">There aren't any jobs.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs uppercase font-semibold bg-slate-50">
                  <th className="px-5 py-3">Job ID</th>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Payload</th>
                  <th className="px-5 py-3">Queue</th>
                  <th className="px-5 py-3">Attempts</th>
                  <th className="px-5 py-3 text-right">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500 max-w-[120px] truncate">
                      <Link to={`/jobs/${encodeURIComponent(job.id)}?queue=${encodeURIComponent(job.queue)}`} className="hover:text-indigo-600">
                        {job.id}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-800">
                      <Link to={`/jobs/${encodeURIComponent(job.id)}?queue=${encodeURIComponent(job.queue)}`} className="hover:text-indigo-600">
                        {job.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600 max-w-[320px] truncate" title={payloadPreview(job.payload)}>
                      {payloadPreview(job.payload)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">
                      <Link to={`/queues/${encodeURIComponent(job.queue)}`} className="hover:text-indigo-600">
                        {job.queue}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{job.attempts}</td>
                    <td className="px-5 py-3 text-right text-slate-400 text-xs">{relativeTime(job.completedAt ?? job.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}