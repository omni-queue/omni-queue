/* eslint-disable @typescript-eslint/no-explicit-any */


import { QueueConfig } from '../interfaces/queue-config';
import { QueueStorage } from '../interfaces/queue-storage';
import { Plugin } from '../interfaces/plugin';
import { LifecycleEventBus } from './lifecycle-events';
/**
 * ScheduledJobPromoter
 *
 * Background task that detects when delayed jobs are ready and promotes them
 * from the deferred queue to the active queue for processing.
 *
 * Runs on a configurable interval (default: 1 second) and:
 * 1. Queries deferred queue for jobs where delayUntil <= now()
 * 2. Moves ready jobs to active queue
 * 3. Emits 'job:promoted' events via plugins
 */
export class ScheduledJobPromoter {
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private storage: QueueStorage,
    private queues: Record<string, QueueConfig>,
    private pollingIntervalMs: number = 100,
    private globalPlugins: Plugin[] = [],
    private lifecycleEvents?: LifecycleEventBus
  ) {}

  start(): void {
    if (this.running) return;

    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(): void {
    if (!this.running) return;

    this.timer = setTimeout(() => {
      void this.tick();
    }, this.pollingIntervalMs);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      await this.promote();
    } catch (error) {
      console.error('[promoter] Error promoting delayed jobs:', error);
    } finally {
      this.scheduleNext();
    }
  }

  private async promote(): Promise<void> {
    const now = Date.now();

    for (const [queueName] of Object.entries(this.queues)) {
      try {
        // Get all jobs that should be promoted (delayUntil <= now)
        const readyJobs = await this.storage.getDelayedJobs(queueName, now);

        for (const job of readyJobs) {
          try {
            // Move job from deferred to active queue
            await this.storage.moveJobToQueue(queueName, job.id, 'active');
            this.lifecycleEvents?.emit({
              type: 'job.promoted',
              queueName,
              jobId: job.id,
              jobName: job.name,
            });

            // Emit plugin hook
            for (const plugin of this.globalPlugins) {
              if (plugin.onJobPromoted) {
                await plugin.onJobPromoted(job);
              }
            }
          } catch (error) {
            console.error(`[promoter] Error promoting job ${job.id}:`, error);
          }
        }
      } catch (error) {
        console.error(`[promoter] Error processing queue ${queueName}:`, error);
      }
    }
  }
}
