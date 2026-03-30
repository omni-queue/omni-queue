import type {
  CounterPoint,
  DataDogExportOptions,
  GaugePoint,
  HistogramPoint,
  MetricLabels,
  MetricsSnapshot,
  PrometheusExportOptions,
  StatsDExportOptions,
} from './types';

function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

function labelsToProm(labels?: MetricLabels): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const body = Object.keys(labels)
    .sort()
    .map((key) => `${key}="${String(labels[key]).replace(/"/g, '\\"')}"`)
    .join(',');
  return `{${body}}`;
}

function labelsToTags(labels?: MetricLabels): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  return `|#${Object.keys(labels)
    .sort()
    .map((key) => `${key}:${String(labels[key])}`)
    .join(',')}`;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function appendCounter(lines: string[], point: CounterPoint, prefix = ''): void {
  const metric = sanitizeMetricName(`${prefix}${point.name}`);
  lines.push(`${metric}${labelsToProm(point.labels)} ${point.value}`);
}

function appendGauge(lines: string[], point: GaugePoint, prefix = ''): void {
  const metric = sanitizeMetricName(`${prefix}${point.name}`);
  lines.push(`${metric}${labelsToProm(point.labels)} ${point.value}`);
}

function appendHistogram(lines: string[], point: HistogramPoint, prefix = ''): void {
  const metric = sanitizeMetricName(`${prefix}${point.name}`);
  const values = point.values;
  const sum = values.reduce((s, value) => s + value, 0);
  lines.push(`${metric}_count${labelsToProm(point.labels)} ${values.length}`);
  lines.push(`${metric}_sum${labelsToProm(point.labels)} ${sum}`);
  lines.push(`${metric}_avg${labelsToProm(point.labels)} ${avg(values)}`);
}

export function exportPrometheus(
  snapshot: MetricsSnapshot,
  options: PrometheusExportOptions = {}
): string {
  const includeHelp = options.includeHelp ?? true;
  const lines: string[] = [];

  if (includeHelp) {
    lines.push('# Omni Queue metrics');
  }

  for (const point of snapshot.counters) appendCounter(lines, point);
  for (const point of snapshot.gauges) appendGauge(lines, point);
  for (const point of snapshot.histograms) appendHistogram(lines, point);

  return `${lines.join('\n')}\n`;
}

export function exportStatsD(
  snapshot: MetricsSnapshot,
  options: StatsDExportOptions = {}
): string[] {
  const prefix = options.prefix ? `${options.prefix}.` : '';
  const lines: string[] = [];

  for (const point of snapshot.counters) {
    lines.push(`${sanitizeMetricName(`${prefix}${point.name}`)}:${point.value}|c`);
  }

  for (const point of snapshot.gauges) {
    lines.push(`${sanitizeMetricName(`${prefix}${point.name}`)}:${point.value}|g`);
  }

  for (const point of snapshot.histograms) {
    lines.push(`${sanitizeMetricName(`${prefix}${point.name}`)}:${avg(point.values)}|h`);
  }

  return lines;
}

export function exportDataDog(
  snapshot: MetricsSnapshot,
  options: DataDogExportOptions = {}
): string[] {
  const prefix = options.prefix ? `${options.prefix}.` : '';
  const lines: string[] = [];

  for (const point of snapshot.counters) {
    lines.push(
      `${sanitizeMetricName(`${prefix}${point.name}`)}:${point.value}|c${labelsToTags(point.labels)}`
    );
  }

  for (const point of snapshot.gauges) {
    lines.push(
      `${sanitizeMetricName(`${prefix}${point.name}`)}:${point.value}|g${labelsToTags(point.labels)}`
    );
  }

  for (const point of snapshot.histograms) {
    lines.push(
      `${sanitizeMetricName(`${prefix}${point.name}`)}:${avg(point.values)}|h${labelsToTags(point.labels)}`
    );
  }

  return lines;
}
