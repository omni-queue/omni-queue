import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Clock3, Database, Hash, Layers, ShieldAlert } from 'lucide-react';
import { dashboardFetch } from '../auth';
import { API_BASE, type JobRow } from '../types';

type JobDetailResponse = {
  status: 'ok';
  source: 'ready' | 'active' | 'completed' | 'pending-deferred' | 'promoted-deferred' | 'dlq';
  job: JobRow & {
    payload?: unknown;
    result?: unknown;
    maxAttempts?: number;
    idempotencyKey?: string;
    priority?: string;
    scheduledCron?: string;
    lastScheduledAt?: number;
  };
};

export function JobDetailPage() {
  const { jobId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<JobDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    const queue = searchParams.get('queue');
    if (queue) params.set('queue', queue);

    dashboardFetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `${response.status} ${response.statusText}`);
        }
        return response.json() as Promise<JobDetailResponse>;
      })
      .then((payload) => {
        setData(payload);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load job detail');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [jobId, searchParams]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-500 mb-3">
          <ArrowLeft className="h-4 w-4" /> Back to jobs
        </Link>
        <h2 className="text-2xl font-bold text-slate-900">Job Detail</h2>
        <p className="text-slate-400 text-sm mt-1 font-mono break-all">{jobId}</p>
      </div>

      {loading && <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-8 text-slate-400 text-sm">Loading job…</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DetailStat icon={<Layers className="h-4 w-4" />} label="Queue" value={data.job.queue} mono />
            <DetailStat icon={<Clock3 className="h-4 w-4" />} label="State" value={data.job.state} />
            <DetailStat icon={<ShieldAlert className="h-4 w-4" />} label="Source" value={data.source} />
            <DetailStat icon={<Hash className="h-4 w-4" />} label="Attempts" value={`${data.job.attempts}/${data.job.maxAttempts ?? '—'}`} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-900">Payload</h3>
              </div>
              <pre className="p-5 text-xs overflow-auto bg-slate-950 text-slate-100 min-h-[240px]">{JSON.stringify(data.job.payload ?? null, null, 2)}</pre>
            </section>

            <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900">Metadata</h3>
              </div>
              <dl className="divide-y divide-slate-50 text-sm">
                <MetaRow label="Name" value={data.job.name} />
                <MetaRow label="Priority" value={data.job.priority ?? '—'} />
                <MetaRow label="Progress" value={data.job.progress != null ? `${data.job.progress}%` : '—'} />
                <MetaRow label="Created" value={new Date(data.job.createdAt).toLocaleString()} />
                <MetaRow label="Updated" value={new Date(data.job.updatedAt).toLocaleString()} />
                <MetaRow label="Completed" value={data.job.completedAt ? new Date(data.job.completedAt).toLocaleString() : '—'} />
                <MetaRow label="Delay Until" value={data.job.delayUntil ? new Date(data.job.delayUntil).toLocaleString() : '—'} />
                <MetaRow label="Batch" value={data.job.batchName ?? data.job.batchId ?? '—'} mono={Boolean(data.job.batchId)} />
                <MetaRow label="Idempotency Key" value={data.job.idempotencyKey ?? '—'} mono />
                <MetaRow label="Scheduled Cron" value={data.job.scheduledCron ?? '—'} mono />
              </dl>
            </section>
          </div>

          {data.job.result !== undefined && (
            <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-900">Result</h3>
              </div>
              <pre className="p-5 text-xs overflow-auto bg-slate-950 text-slate-100 min-h-[180px]">{JSON.stringify(data.job.result, null, 2)}</pre>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function DetailStat({ icon, label, value, mono = false }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">{icon}{label}</div>
      <div className={`text-lg font-semibold text-slate-900 ${mono ? 'font-mono break-all text-sm' : ''}`}>{value}</div>
    </div>
  );
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 px-5 py-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`text-slate-800 ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</dd>
    </div>
  );
}
