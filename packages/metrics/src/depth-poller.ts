import type { MetricsCollector } from './collector';
import type { DepthPollerOptions, QueueDepthProvider } from './types';

/**
 * Periodically samples queue depth via a provider and writes gauge metrics.
 */
export class QueueDepthPoller {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private provider: QueueDepthProvider,
    private collector: MetricsCollector,
    private options: DepthPollerOptions
  ) {}

  start(): void {
    if (this.interval) return;
    const intervalMs = this.options.intervalMs ?? 2000;
    this.interval = setInterval(() => {
      void this.capture();
    }, intervalMs);
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  async capture(): Promise<void> {
    for (const queueName of this.options.queueNames) {
      const depth = await this.provider.getQueueDepth([queueName]);
      this.collector.setGauge('queue_depth', depth, { queue: queueName });
    }
  }
}
