import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock3, Layers, ShieldAlert, TimerReset } from 'lucide-react';
import { dashboardFetch } from '../auth';
import { API_BASE, type JobRow } from '../types';
import { useDashboardData } from '../contexts/DashboardDataContext';

async function fetchJobs(queueName: string, status: string) {
  const params = new URLSearchParams({ queue: queueName, status, limit: '50' });
  const response = await dashboardFetch(`${API_BASE}/jobs?${params.toString()}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const payload = (await response.json()) as { jobs: JobRow[] };
  return payload.jobs;
}

export function QueueDetailPage() {
  const { queueName = '' } = useParams();
  const { queues, overview } = useDashboardData();
  const queue = useMemo(() => queues.find((item) => item.queue === queueName), [queueName, queues]);
  const reliability = useMemo(
    () => overview?.reliability?.queues.find((entry) => entry.queueName === queueName),
    [overview, queueName]
  );

  const [pendingJobs, setPendingJobs] = useState<JobRow[]>([]);
  const [promotedJobs, setPromotedJobs] = useState<JobRow[]>([]);
  const [dlqJobs, setDlqJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!queueName) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchJobs(queueName, 'pending-deferred'),
      fetchJobs(queueName, 'promoted-deferred'),
      fetchJobs(queueName, 'dlq'),
    ])
      .then(([pending, promoted, dlq]) => {
        setPendingJobs(pending);
        setPromotedJobs(promoted);
        setDlqJobs(dlq);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load queue detail');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [queueName]);

  if (!queue) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/queues" className="text-sm text-indigo-600 hover:text-indigo-500">← Back to queues</Link>
        <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-8 text-slate-500">Queue not found.</div>
      </div>
    );
  }

  const totalTracked = pendingJobs.length + promotedJobs.length + dlqJobs.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/queues" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-500 mb-3">
            <ArrowLeft className="h-4 w-4" /> Back to queues
          </Link>
          <h2 className="text-2xl font-bold text-slate-900 font-mono">{queue.queue}</h2>
          <p className="text-slate-400 text-sm mt-1">Connection: {queue.connection}</p>
        </div>
        <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-slate-100 text-slate-700">
          configured concurrency: {queue.configuredConcurrency}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Layers className="h-4 w-4" />} label="Load" value={queue.load ?? queue.depth} tone="slate" />
        <StatCard icon={<Clock3 className="h-4 w-4" />} label="Scheduled (Waiting)" value={pendingJobs.length} tone="amber" />
        <StatCard icon={<TimerReset className="h-4 w-4" />} label="Scheduled (Ready)" value={promotedJobs.length} tone="indigo" />
        <StatCard icon={<ShieldAlert className="h-4 w-4" />} label="Failed" value={dlqJobs.length} tone="red" />
      </div>

      <section className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Reliability</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-100 px-4 py-3">
            <div className="text-xs text-slate-400 uppercase font-semibold">Circuit</div>
            <div
              className={`text-lg font-semibold mt-1 ${
                reliability?.circuitState === 'open'
                  ? 'text-red-600'
                  : reliability?.circuitState === 'half-open'
                    ? 'text-amber-600'
                    : 'text-emerald-600'
              }`}
            >
              {reliability?.circuitState ?? 'closed'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-100 px-4 py-3">
            <div className="text-xs text-slate-400 uppercase font-semibold">Backpressure</div>
            <div className={`text-lg font-semibold mt-1 ${reliability?.backpressureActive ? 'text-amber-600' : 'text-emerald-600'}`}>
              {reliability?.backpressureActive ? 'active' : 'clear'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-100 px-4 py-3">
            <div className="text-xs text-slate-400 uppercase font-semibold">Updated</div>
            <div className="text-lg font-semibold mt-1 text-slate-900">
              {reliability?.updatedAt ? new Date(reliability.updatedAt).toLocaleTimeString() : '—'}
            </div>
          </div>
        </div>
      </section>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-3">
        <JobsPanel title="Scheduled (Waiting)" jobs={pendingJobs} empty="No waiting scheduled jobs." />
        <JobsPanel title="Scheduled (Ready)" jobs={promotedJobs} empty="No ready scheduled jobs." />
        <JobsPanel title="Failed Jobs" jobs={dlqJobs} empty="No failed jobs." />
      </div>

      {!loading && totalTracked === 0 && (
        <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-6 text-sm text-slate-500">
          No scheduled or failed jobs found for this queue.
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'slate' | 'amber' | 'indigo' | 'red' }) {
  const toneClass = {
    slate: 'text-slate-900',
    amber: 'text-amber-600',
    indigo: 'text-indigo-600',
    red: 'text-red-600',
  }[tone];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">{icon}{label}</div>
      <div className={`text-3xl font-bold ${toneClass}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function JobsPanel({ title, jobs, empty }: { title: string; jobs: JobRow[]; empty: string }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      {jobs.length === 0 ? (
        <div className="px-5 py-8 text-sm text-slate-400">{empty}</div>
      ) : (
        <div className="divide-y divide-slate-50">
          {jobs.map((job) => (
            <Link key={job.id} to={`/jobs/${encodeURIComponent(job.id)}?queue=${encodeURIComponent(job.queue)}`} className="block px-5 py-3 hover:bg-slate-50 transition-colors">
              <div className="font-medium text-slate-800 truncate">{job.name}</div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-400">
                <span className="font-mono truncate">{job.id}</span>
                <span>{job.attempts} attempt{job.attempts !== 1 ? 's' : ''}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
