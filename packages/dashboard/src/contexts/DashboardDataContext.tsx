import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { API_BASE, DASHBOARD_TRANSPORT, type DashboardTransport, type OverviewResponse } from '../types';
import { useWebSocket, type WsStatus } from '../hooks/useWebSocket';
import { overviewToSample } from '../pages/MetricsPage';

export type MetricSample = {
  ts: number;
  depth: number;
  deferred: number;
  dlq: number;
  completed: number;
  recentCompletionTimestamps: number[];
};

type DashboardDataContextValue = {
  overview: OverviewResponse | null;
  queues: OverviewResponse['queues'];
  samples: MetricSample[];
  wsStatus: WsStatus;
  transportMode: DashboardTransport;
  refreshOverview: () => Promise<void>;
};

const DashboardDataContext = createContext<DashboardDataContextValue | undefined>(undefined);

function buildOverviewSignature(data: OverviewResponse): string {
  const queueSignature = [...data.queues]
    .sort((a, b) => a.queue.localeCompare(b.queue))
    .map((queue) => `${queue.queue}:${queue.depth}:${queue.deferredCount}:${queue.dlqCount}`)
    .join('|');

  const reliabilitySignature = (data.reliability?.queues ?? [])
    .slice()
    .sort((a, b) => a.queueName.localeCompare(b.queueName))
    .map(
      (queue) => `${queue.queueName}:${queue.circuitState}:${queue.backpressureActive ? 'bp' : 'ok'}:${queue.updatedAt}`
    )
    .join('|');

  const scalingSignature = Object.entries(data.workers.desiredScaling)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, concurrency]) => `${name}:${concurrency}`)
    .join('|');

  return `${data.totals.depth}:${data.totals.deferred}:${data.totals.dlq}:${data.totals.completed}::${queueSignature}::${scalingSignature}::${reliabilitySignature}`;
}

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [samples, setSamples] = useState<MetricSample[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSignatureRef = useRef<string | null>(null);
  const retentionMs = 60 * 60 * 1000;

  const handleOverview = useCallback((data: OverviewResponse) => {
    const signature = buildOverviewSignature(data);
    if (lastSignatureRef.current === signature) {
      return;
    }

    lastSignatureRef.current = signature;
    setOverview(data);
    setSamples((prev) => {
      const sample = overviewToSample(data);
      const cutoff = sample.ts - retentionMs;
      return [...prev, sample].filter((entry) => entry.ts >= cutoff);
    });
  }, []);

  const wsStatus = useWebSocket(handleOverview);

  const refreshOverview = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/overview`);
      if (!response.ok) return;
      const data = (await response.json()) as OverviewResponse;
      handleOverview(data);
    } catch {
      // ignore transient transport errors
    }
  }, [handleOverview]);

  useEffect(() => {
    if (wsStatus === 'disconnected') {
      pollRef.current = setInterval(() => {
        void refreshOverview();
      }, 5000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshOverview, wsStatus]);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const value = useMemo<DashboardDataContextValue>(
    () => ({
      overview,
      queues: overview?.queues ?? [],
      samples,
      wsStatus,
      transportMode: DASHBOARD_TRANSPORT,
      refreshOverview,
    }),
    [overview, refreshOverview, samples, wsStatus]
  );

  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardData() {
  const context = useContext(DashboardDataContext);
  if (!context) throw new Error('useDashboardData must be used within DashboardDataProvider');
  return context;
}
