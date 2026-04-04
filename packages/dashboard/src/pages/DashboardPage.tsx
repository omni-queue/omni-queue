import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CalendarClock, Gauge, Layers, ShieldAlert } from 'lucide-react';
import { dashboardFetch } from '../auth';
import type { JobRow, OverviewResponse } from '../types';
import { API_BASE } from '../types';

type Props = { overview: OverviewResponse | null };

function StatCard({
  icon,
  label,
  value,
  color = 'text-slate-900',
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">
        {icon}
        {label}
      </div>
      <div className={`text-4xl font-bold tracking-tight ${color}`}>{value}</div>
    </div>
  );
}

export function DashboardPage({ overview }: Props) {
  const [failedJobs, setFailedJobs] = useState<JobRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadFailedJobs = async () => {
      try {
        const response = await dashboardFetch(`${API_BASE}/failed?limit=8`);
        if (!response.ok) return;
        const payload = (await response.json()) as { jobs?: JobRow[] };
        if (!cancelled) {
          setFailedJobs(payload.jobs ?? []);
        }
      } catch {
        if (!cancelled) {
          setFailedJobs([]);
        }
      }
    };

    void loadFailedJobs();
    const timer = setInterval(() => {
      void loadFailedJobs();
    }, 7000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!overview) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading overview…
      </div>
    );
  }

  const failedColor =
    overview.totals.dlq > 0
      ? 'text-red-600'
      : overview.totals.dlq === 0
        ? 'text-emerald-600'
        : 'text-slate-900';

  const since = new Date(overview.generatedAt).toLocaleTimeString();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
        <p className="text-slate-400 text-sm mt-1">Last updated at {since}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Load"
          value={(overview.totals.load ?? overview.totals.depth).toLocaleString()}
          color={(overview.totals.load ?? overview.totals.depth) > 500 ? 'text-amber-600' : 'text-slate-900'}
        />
        <StatCard
          icon={<Gauge className="h-4 w-4" />}
          label="Delayed Jobs"
          value={overview.totals.deferred.toLocaleString()}
        />
        <StatCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Schedules"
          value={(overview.totals.schedules ?? 0).toLocaleString()}
        />
        <StatCard
          icon={<ShieldAlert className="h-4 w-4" />}
          label="Failed"
          value={overview.totals.dlq.toLocaleString()}
          color={failedColor}
        />
        <StatCard
          icon={<Layers className="h-4 w-4" />}
          label="Queues"
          value={overview.queues.length}
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Queue Summary</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 text-xs uppercase font-semibold bg-slate-50">
              <th className="px-6 py-3">Queue</th>
              <th className="px-6 py-3 text-right">Load</th>
              <th className="px-6 py-3 text-right">Scheduled</th>
              <th className="px-6 py-3 text-right">Schedules</th>
              <th className="px-6 py-3 text-right">Failed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {overview.queues.map((q) => (
              <tr key={q.queue} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-3 font-mono font-medium text-slate-800">{q.queue}</td>
                <td className="px-6 py-3 text-right text-slate-700">{(q.load ?? q.depth).toLocaleString()}</td>
                <td className="px-6 py-3 text-right text-slate-700">{q.deferredCount.toLocaleString()}</td>
                <td className="px-6 py-3 text-right text-slate-700">{(q.repeatableCount ?? 0).toLocaleString()}</td>
                <td className="px-6 py-3 text-right">
                  <span
                    className={
                      q.dlqCount > 0
                        ? 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700'
                        : 'text-emerald-600'
                    }
                  >
                    {q.dlqCount > 0 ? q.dlqCount.toLocaleString() : '✓'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Queue Health</h3>
            <span className="text-xs text-slate-400">Simple status view</span>
          </div>
          <div className="divide-y divide-slate-50">
            {overview.queues.map((queue) => {
              const hasFailures = queue.dlqCount > 0;
              return (
                <div key={queue.queue} className="px-6 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 font-mono truncate">{queue.queue}</div>
                    <div className="text-xs text-slate-400">load {(queue.load ?? queue.depth).toLocaleString()} · scheduled {queue.deferredCount.toLocaleString()}</div>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${hasFailures ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {hasFailures ? `${queue.dlqCount} failed` : 'healthy'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Recent Failed Jobs</h3>
            <Link to="/failed" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">View all</Link>
          </div>
          {failedJobs.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-400">No recent failed jobs.</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {failedJobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/jobs/${encodeURIComponent(job.id)}?queue=${encodeURIComponent(job.queue)}`}
                  className="block px-6 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{job.name}</div>
                      <div className="text-xs text-slate-400 font-mono truncate">{job.queue} · {job.id}</div>
                    </div>
                    <span className="text-xs text-slate-500">{job.attempts} tries</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
