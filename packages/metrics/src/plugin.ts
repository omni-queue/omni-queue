import type { Plugin, StoredJob } from '@vasto/core';
import type { MetricsCollector } from './collector';

/**
 * Auto-collection plugin for Vasto runtime hooks.
 * Captures enqueue, processing duration, failures, and progress updates.
 */
export class QueueMetricsPlugin implements Plugin {
  name = 'QueueMetricsPlugin';

  private startedAt = new Map<string, number>();

  constructor(private collector: MetricsCollector) {}

  async onEnqueue(job: { queue(): string }): Promise<void> {
    const queue = job.queue();
    this.collector.increment('jobs_enqueued_total', 1, { queue });
  }

  async onProcessStart(job: StoredJob): Promise<void> {
    this.startedAt.set(job.id, Date.now());
    this.collector.increment('jobs_processing_started_total', 1, { queue: job.queue, name: job.name });
  }

  async onProcessEnd(job: StoredJob): Promise<void> {
    const startedAt = this.startedAt.get(job.id);
    if (startedAt !== undefined) {
      const durationMs = Date.now() - startedAt;
      this.collector.observe('job_duration_ms', durationMs, { queue: job.queue, name: job.name });
      this.startedAt.delete(job.id);
    }

    this.collector.increment('jobs_processed_total', 1, { queue: job.queue, name: job.name });
  }

  async onFail(job: StoredJob): Promise<void> {
    this.collector.increment('jobs_failed_total', 1, { queue: job.queue, name: job.name });
  }

  async onFailedPermanently(job: StoredJob): Promise<void> {
    this.collector.increment('jobs_dlq_total', 1, { queue: job.queue, name: job.name });
  }

  async onProgress(jobId: string, queueName: string, progress: number): Promise<void> {
    this.collector.setGauge('job_progress_percent', progress, { queue: queueName, job_id: jobId });
  }
}
