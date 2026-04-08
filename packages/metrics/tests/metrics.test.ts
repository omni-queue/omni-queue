import { describe, expect, it } from 'vitest';
import { MetricsCollector } from '../src/collector';
import { exportDataDog, exportPrometheus, exportStatsD } from '../src/exporters';
import { QueueDepthPoller } from '../src/depth-poller';

describe('@vasto-queue/metrics', () => {
  it('collects counters, gauges, and histograms', () => {
    const collector = new MetricsCollector();

    collector.increment('jobs_processed_total', 1, { queue: 'emails' });
    collector.increment('jobs_processed_total', 2, { queue: 'emails' });
    collector.setGauge('queue_depth', 7, { queue: 'emails' });
    collector.observe('job_duration_ms', 10, { queue: 'emails' });
    collector.observe('job_duration_ms', 20, { queue: 'emails' });

    const snapshot = collector.snapshot();

    expect(snapshot.counters[0]?.value).toBe(3);
    expect(snapshot.gauges[0]?.value).toBe(7);
    expect(snapshot.histograms[0]?.values).toEqual([10, 20]);
  });

  it('exports Prometheus, StatsD, and DataDog formats', () => {
    const collector = new MetricsCollector();
    collector.increment('jobs_processed_total', 2, { queue: 'emails' });
    collector.setGauge('queue_depth', 5, { queue: 'emails' });
    collector.observe('job_duration_ms', 12, { queue: 'emails' });

    const snapshot = collector.snapshot();

    const prom = exportPrometheus(snapshot);
    expect(prom).toContain('jobs_processed_total');
    expect(prom).toContain('queue_depth');
    expect(prom).toContain('job_duration_ms_count');

    const statsd = exportStatsD(snapshot, { prefix: 'vasto' });
    expect(statsd.some((line) => line.startsWith('vasto_jobs_processed_total:2|c'))).toBe(true);

    const datadog = exportDataDog(snapshot, { prefix: 'vasto' });
    expect(datadog.some((line) => line.includes('|#queue:emails'))).toBe(true);
  });

  it('captures queue depth via poller', async () => {
    const collector = new MetricsCollector();
    const provider = {
      async getQueueDepth(queueNames: string[]): Promise<number> {
        return queueNames[0] === 'emails' ? 11 : 0;
      },
    };

    const poller = new QueueDepthPoller(provider, collector, { queueNames: ['emails'] });
    await poller.capture();

    const snapshot = collector.snapshot();
    const point = snapshot.gauges.find((g) => g.name === 'queue_depth');
    expect(point?.value).toBe(11);
  });
});
