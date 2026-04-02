import { useCallback, useEffect, useState } from 'react';
import { dashboardFetch } from '../auth';
import type { QueueOverview, RepeatableScheduleRow } from '../types';
import { API_BASE } from '../types';

type Props = { queues: QueueOverview[] };

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function scheduleMode(schedule: RepeatableScheduleRow): string {
  if (schedule.pattern) {
    return `cron: ${schedule.pattern}`;
  }

  if (schedule.intervalMs != null) {
    return `every ${schedule.intervalMs}ms`;
  }

  return 'unknown';
}

export function SchedulesPage({ queues }: Props) {
  const [schedules, setSchedules] = useState<RepeatableScheduleRow[]>([]);
  const [queueFilter, setQueueFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [bulkMutating, setBulkMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: '500' });
      if (queueFilter !== 'all') params.set('queue', queueFilter);
      const res = await dashboardFetch(`${API_BASE}/schedules?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const payload = (await res.json()) as { schedules: RepeatableScheduleRow[] };
      setSchedules(payload.schedules);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, [queueFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeSchedule = async (schedule: RepeatableScheduleRow) => {
    setMutatingId(schedule.id);
    setError(null);
    setSuccess(null);

    try {
      const res = await dashboardFetch(
        `${API_BASE}/schedules/${encodeURIComponent(schedule.id)}/remove`,
        { method: 'POST' }
      );

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `${res.status}`);
      }

      setSchedules((prev) => prev.filter((item) => item.id !== schedule.id));
      setSuccess(`Removed schedule ${schedule.id}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove schedule');
    } finally {
      setMutatingId(null);
    }
  };

  const clearSchedules = async () => {
    setBulkMutating(true);
    setError(null);
    setSuccess(null);

    try {
      const query =
        queueFilter === 'all' ? '' : `?queue=${encodeURIComponent(queueFilter)}`;
      const res = await dashboardFetch(`${API_BASE}/schedules/clear${query}`, { method: 'POST' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `${res.status}`);
      }

      const payload = (await res.json()) as { removed?: number };
      await load();
      setSuccess(
        queueFilter === 'all'
          ? `Cleared ${payload.removed ?? 0} schedule(s).`
          : `Cleared ${payload.removed ?? 0} schedule(s) for ${queueFilter}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear schedules');
    } finally {
      setBulkMutating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Schedules</h2>
          <p className="text-slate-400 text-sm mt-1">
            Review recurring schedules and remove stale definitions safely.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              void load();
            }}
            className="px-4 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={() => {
              void clearSchedules();
            }}
            disabled={bulkMutating || schedules.length === 0}
            className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-40 transition-colors"
          >
            {bulkMutating ? 'Clearing…' : queueFilter === 'all' ? 'Clear all' : 'Clear queue'}
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <select
          value={queueFilter}
          onChange={(e) => setQueueFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="all">All queues</option>
          {queues.map((q) => (
            <option key={q.queue} value={q.queue}>
              {q.queue}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-4 py-3">
          {success}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>
        ) : schedules.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
            No repeatable schedules found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs uppercase font-semibold bg-slate-50">
                  <th className="px-5 py-3">Schedule ID</th>
                  <th className="px-5 py-3">Job</th>
                  <th className="px-5 py-3">Mode</th>
                  <th className="px-5 py-3">Queue</th>
                  <th className="px-5 py-3">Updated</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schedules.map((schedule) => (
                  <tr key={schedule.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-slate-500 max-w-[220px] truncate">
                      {schedule.id}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-800">{schedule.jobName}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{scheduleMode(schedule)}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{schedule.queue}</td>
                    <td className="px-5 py-3 text-slate-500" title={new Date(schedule.updatedAt).toISOString()}>
                      {relativeTime(schedule.updatedAt)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => {
                          void removeSchedule(schedule);
                        }}
                        disabled={mutatingId === schedule.id}
                        className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-40 transition-colors"
                      >
                        {mutatingId === schedule.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
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
