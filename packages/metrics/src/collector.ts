import type {
  CounterPoint,
  GaugePoint,
  HistogramPoint,
  MetricLabels,
  MetricsSnapshot,
} from './types';

function labelsKey(labels?: MetricLabels): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const normalized = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${String(labels[key])}`)
    .join(',');
  return normalized;
}

function withLabelsName(name: string, labels?: MetricLabels): string {
  const key = labelsKey(labels);
  return key ? `${name}|${key}` : name;
}

export class MetricsCollector {
  private counters = new Map<string, CounterPoint>();
  private gauges = new Map<string, GaugePoint>();
  private histograms = new Map<string, HistogramPoint>();

  increment(name: string, value = 1, labels?: MetricLabels): void {
    const key = withLabelsName(name, labels);
    const current = this.counters.get(key);
    if (!current) {
      this.counters.set(key, {
        name,
        value,
        ...(labels ? { labels } : {}),
      });
      return;
    }

    current.value += value;
  }

  setGauge(name: string, value: number, labels?: MetricLabels): void {
    const key = withLabelsName(name, labels);
    this.gauges.set(key, {
      name,
      value,
      ...(labels ? { labels } : {}),
    });
  }

  observe(name: string, value: number, labels?: MetricLabels): void {
    const key = withLabelsName(name, labels);
    const current = this.histograms.get(key);
    if (!current) {
      this.histograms.set(key, {
        name,
        values: [value],
        ...(labels ? { labels } : {}),
      });
      return;
    }

    current.values.push(value);
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: Array.from(this.counters.values()).map((point) => ({
        name: point.name,
        value: point.value,
        ...(point.labels ? { labels: { ...point.labels } } : {}),
      })),
      gauges: Array.from(this.gauges.values()).map((point) => ({
        name: point.name,
        value: point.value,
        ...(point.labels ? { labels: { ...point.labels } } : {}),
      })),
      histograms: Array.from(this.histograms.values()).map((point) => ({
        name: point.name,
        values: [...point.values],
        ...(point.labels ? { labels: { ...point.labels } } : {}),
      })),
    };
  }

  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}
