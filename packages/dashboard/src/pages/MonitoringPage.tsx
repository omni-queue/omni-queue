import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MonitoringTagRow, SloReport } from '../types';
import { API_BASE } from '../types';

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

export function MonitoringPage() {
  const [tags, setTags] = useState<MonitoringTagRow[]>([]);
  const [slo, setSlo] = useState<SloReport | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [monitoringRes, sloRes] = await Promise.all([
        fetch(`${API_BASE}/monitoring`),
        fetch(`${API_BASE}/slo?windowMs=${60 * 60_000}`),
      ]);
      if (!monitoringRes.ok) throw new Error(`${monitoringRes.status} ${monitoringRes.statusText}`);
      if (!sloRes.ok) throw new Error(`${sloRes.status} ${sloRes.statusText}`);

      const monitoringPayload = (await monitoringRes.json()) as { tags: MonitoringTagRow[] };
      const sloPayload = (await sloRes.json()) as { slo: SloReport };
      setTags(monitoringPayload.tags ?? []);
      setSlo(sloPayload.slo ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load monitoring tags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tags;
    return tags.filter((tag) => tag.tag.toLowerCase().includes(normalized));
  }, [query, tags]);

  const formatMs = (value: number | null): string => {
    if (value == null || !Number.isFinite(value)) return '—';
    if (value < 1_000) return `${Math.round(value)}ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
    return `${(value / 60_000).toFixed(1)}m`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Monitoring</h2>
          <p className="text-slate-400 text-sm mt-1">Track job activity by tag across queued, running, completed, and failed work.</p>
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

      <div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter tags…"
          className="w-full sm:w-80 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="text-xs text-slate-400 uppercase font-semibold">P95 Latency</div>
          <div className="text-3xl font-bold text-slate-900 mt-1">{formatMs(slo?.overall.p95LatencyMs ?? null)}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="text-xs text-slate-400 uppercase font-semibold">Success Rate</div>
          <div className="text-3xl font-bold text-emerald-700 mt-1">{(slo?.overall.successRatePct ?? 100).toFixed(1)}%</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="text-xs text-slate-400 uppercase font-semibold">Mean Recovery</div>
          <div className="text-3xl font-bold text-slate-900 mt-1">{formatMs(slo?.overall.meanRecoveryMs ?? null)}</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="text-xs text-slate-400 uppercase font-semibold">Recovered Incidents</div>
          <div className="text-3xl font-bold text-slate-900 mt-1">{(slo?.overall.recoveredIncidents ?? 0).toLocaleString()}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">SLO by Queue</h3>
        </div>
        {!slo || slo.queues.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-400">No SLO data available for the selected window.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs uppercase font-semibold bg-slate-50">
                  <th className="px-5 py-3">Queue</th>
                  <th className="px-5 py-3 text-right">P95 Latency</th>
                  <th className="px-5 py-3 text-right">Success Rate</th>
                  <th className="px-5 py-3 text-right">Mean Recovery</th>
                  <th className="px-5 py-3 text-right">Completed</th>
                  <th className="px-5 py-3 text-right">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {slo.queues.map((queue) => (
                  <tr key={queue.queueName} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-mono text-slate-800">{queue.queueName}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{formatMs(queue.p95LatencyMs)}</td>
                    <td className="px-5 py-3 text-right text-emerald-700">{queue.successRatePct.toFixed(1)}%</td>
                    <td className="px-5 py-3 text-right text-slate-700">{formatMs(queue.meanRecoveryMs)}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{queue.completed.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-red-700">{queue.failed.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">No monitored tags yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs uppercase font-semibold bg-slate-50">
                  <th className="px-5 py-3">Tag</th>
                  <th className="px-5 py-3 text-right">Ready</th>
                  <th className="px-5 py-3 text-right">Running</th>
                  <th className="px-5 py-3 text-right">Completed</th>
                  <th className="px-5 py-3 text-right">Failed</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((tag) => (
                  <tr key={tag.tag} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900">{tag.tag}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{tag.ready}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{tag.active}</td>
                    <td className="px-5 py-3 text-right text-emerald-700">{tag.completed}</td>
                    <td className="px-5 py-3 text-right text-red-700">{tag.failed}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-900">{tag.total}</td>
                    <td className="px-5 py-3 text-right text-slate-400 text-xs">{tag.lastSeenAt ? relativeTime(tag.lastSeenAt) : '—'}</td>
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