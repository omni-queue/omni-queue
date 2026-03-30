import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { JobRow, QueueOverview } from '../types';
import { API_BASE } from '../types';

const STATUS_OPTIONS = [
    { value: 'all', label: 'All jobs' },
    { value: 'ready', label: 'Ready to run' },
    { value: 'active', label: 'Running' },
    { value: 'completed', label: 'Completed jobs' },
    { value: 'deferred', label: 'Scheduled (all)' },
    { value: 'pending-deferred', label: 'Scheduled (waiting)' },
    { value: 'promoted-deferred', label: 'Scheduled (ready)' },
    { value: 'dlq', label: 'Failed jobs' },
];

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

export function JobsPage({ queues }: Props) {
    const [jobs, setJobs] = useState<JobRow[]>([]);
    const [status, setStatus] = useState('all');
    const [queueFilter, setQueueFilter] = useState('all');
    const [page, setPage] = useState(0);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const pageSize = 50;

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                ...(status !== 'all' ? { status } : {}),
                limit: String(pageSize + 1),
                offset: String(page * pageSize),
            });
            if (queueFilter !== 'all') params.set('queue', queueFilter);
            const res = await fetch(`${API_BASE}/jobs?${params.toString()}`);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const payload = (await res.json()) as { jobs: JobRow[] };
            const hasMore = payload.jobs.length > pageSize;
            setHasNextPage(hasMore);
            setJobs(hasMore ? payload.jobs.slice(0, pageSize) : payload.jobs);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load jobs');
        } finally {
            setLoading(false);
        }
    }, [status, queueFilter, page]);

    useEffect(() => {
        setPage(0);
    }, [status, queueFilter]);

    useEffect(() => { void load(); }, [load]);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">Jobs</h2>
                    <p className="text-slate-400 text-sm mt-1">Browse all jobs: ready to run, currently running, scheduled, or failed.</p>
                </div>
                <button
                    onClick={() => { void load(); }}
                    className="px-4 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
                >
                    Refresh
                </button>
            </div>

            <div className="flex flex-wrap gap-3">
                <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                    {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>

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

                <div className="ml-auto flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setPage((current) => Math.max(0, current - 1))}
                        disabled={loading || page === 0}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Prev
                    </button>
                    <span className="text-sm text-slate-500 min-w-[72px] text-center">Page {page + 1}</span>
                    <button
                        type="button"
                        onClick={() => setPage((current) => current + 1)}
                        disabled={loading || !hasNextPage}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Next
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                    {error}
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center h-32 text-slate-400 text-sm">Loading…</div>
                ) : jobs.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-slate-400 text-sm">No jobs found.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-slate-400 text-xs uppercase font-semibold bg-slate-50">
                                    <th className="px-5 py-3">Job ID</th>
                                    <th className="px-5 py-3">Name</th>
                                    <th className="px-5 py-3">Payload</th>
                                    <th className="px-5 py-3">Queue</th>
                                    <th className="px-5 py-3">State</th>
                                    <th className="px-5 py-3 text-right">Attempts</th>
                                    <th className="px-5 py-3 text-right">Created</th>
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
                                        <td className="px-5 py-3">
                                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                                                {job.state}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-right text-slate-700">{job.attempts}</td>
                                        <td className="px-5 py-3 text-right text-slate-400 text-xs">{relativeTime(job.createdAt)}</td>
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
