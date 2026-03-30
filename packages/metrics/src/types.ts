export type MetricLabels = Record<string, string | number | boolean>;

export interface CounterPoint {
  name: string;
  value: number;
  labels?: MetricLabels;
}

export interface GaugePoint {
  name: string;
  value: number;
  labels?: MetricLabels;
}

export interface HistogramPoint {
  name: string;
  values: number[];
  labels?: MetricLabels;
}

export interface QueueDepthSnapshot {
  queue: string;
  depth: number;
  capturedAt: number;
}

export interface QueueDepthProvider {
  getQueueDepth(queueNames: string[]): Promise<number>;
}

export interface MetricsSnapshot {
  counters: CounterPoint[];
  gauges: GaugePoint[];
  histograms: HistogramPoint[];
}

export interface DepthPollerOptions {
  queueNames: string[];
  intervalMs?: number;
}

export interface StatsDExportOptions {
  prefix?: string;
}

export interface DataDogExportOptions {
  prefix?: string;
}

export interface PrometheusExportOptions {
  includeHelp?: boolean;
}
