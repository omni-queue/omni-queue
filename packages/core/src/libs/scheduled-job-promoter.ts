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
  private static readonly PROMOTION_BATCH_LIMIT = 256;
  private static readonly FAST_RECHECK_MS = 1;
  private static readonly MAX_BATCHES_PER_QUEUE_TICK = 8;

  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextScheduledAt: number | undefined;
  private requestedWakeAt: number | undefined;

  private diagnosticsEnabled(): boolean {
    const raw = process.env['VASTO_BENCH_PROMOTER_DIAG']?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }

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
    this.timer = undefined;
    this.nextScheduledAt = undefined;
    this.requestedWakeAt = undefined;
  }

  requestRescheduleAt(scheduleAt: number): void {
    if (!this.running || !Number.isFinite(scheduleAt)) {
      return;
    }

    const targetAt = Math.max(Date.now() + ScheduledJobPromoter.FAST_RECHECK_MS, Math.floor(scheduleAt));

    if (this.timer && this.nextScheduledAt != null) {
      if (this.nextScheduledAt <= targetAt) {
        return;
      }

      clearTimeout(this.timer);
      this.timer = undefined;
      this.scheduleNext(targetAt - Date.now());
      return;
    }

    if (this.requestedWakeAt == null || targetAt < this.requestedWakeAt) {
      this.requestedWakeAt = targetAt;
    }
  }

  private scheduleNext(delayMs: number = this.pollingIntervalMs): void {
    if (!this.running) return;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    const effectiveDelayMs = Math.max(ScheduledJobPromoter.FAST_RECHECK_MS, Math.floor(delayMs));
    this.nextScheduledAt = Date.now() + effectiveDelayMs;
    const scheduledAt = this.nextScheduledAt;

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.nextScheduledAt = undefined;
      void this.tick(scheduledAt);
    }, effectiveDelayMs);
  }

  private async tick(scheduledAt?: number): Promise<void> {
    if (!this.running) return;

    const tickStartedAt = Date.now();
    let shouldFastRecheck = false;
    let nextDelayMs: number | undefined;
    let diagnosticSummary:
      | {
          promotedAny: boolean;
          nextDelayMs?: number;
          queueStats: Array<{ queueName: string; promotedCount: number; durationMs: number }>;
        }
      | undefined;

    try {
      const result = await this.promote();
      shouldFastRecheck = result.promotedAny;
      nextDelayMs = result.nextDelayMs;
      diagnosticSummary = result;
    } catch (error) {
      console.error('[promoter] Error promoting delayed jobs:', error);
    } finally {
      const computedDelay = shouldFastRecheck
        ? ScheduledJobPromoter.FAST_RECHECK_MS
        : nextDelayMs != null
          ? Math.max(ScheduledJobPromoter.FAST_RECHECK_MS, nextDelayMs)
          : this.pollingIntervalMs;
      const requestedDelay = this.requestedWakeAt != null
        ? Math.max(ScheduledJobPromoter.FAST_RECHECK_MS, this.requestedWakeAt - Date.now())
        : undefined;
      this.requestedWakeAt = undefined;
      const delay = requestedDelay != null ? Math.min(computedDelay, requestedDelay) : computedDelay;

      if (this.diagnosticsEnabled()) {
        const wakeDriftMs = scheduledAt != null ? Math.max(0, tickStartedAt - scheduledAt) : 0;
        const tickDurationMs = Math.max(0, Date.now() - tickStartedAt);
        console.log(
          `[promoter-diag] tick wakeDrift=${wakeDriftMs}ms duration=${tickDurationMs}ms ` +
            `promotedAny=${diagnosticSummary?.promotedAny === true} nextDelay=${nextDelayMs ?? '-'}ms rescheduleIn=${delay}ms`,
        );
        if (diagnosticSummary && diagnosticSummary.queueStats.length > 0) {
          console.log(`[promoter-diag] queues=${JSON.stringify(diagnosticSummary.queueStats)}`);
        }
      }

      this.scheduleNext(delay);
    }
  }

  private async promote(): Promise<{
    promotedAny: boolean;
    nextDelayMs?: number;
    queueStats: Array<{ queueName: string; promotedCount: number; durationMs: number }>;
  }> {
    const now = Date.now();
    const promotionHooks = this.globalPlugins.filter((plugin) => typeof plugin.onJobPromoted === 'function');
    let promotedAny = false;
    let nextDueAt: number | undefined;
    const queueStats: Array<{ queueName: string; promotedCount: number; durationMs: number }> = [];

    await Promise.all(
      Object.entries(this.queues).map(async ([queueName]) => {
        const queueStartedAt = Date.now();
        let promotedCount = 0;
        try {
          for (let batch = 0; batch < ScheduledJobPromoter.MAX_BATCHES_PER_QUEUE_TICK; batch++) {
            let promotedJobs = typeof this.storage.promoteDelayedJobs === 'function'
              ? await this.storage.promoteDelayedJobs(queueName, now, ScheduledJobPromoter.PROMOTION_BATCH_LIMIT)
              : undefined;

            if (!promotedJobs) {
              const readyJobs = await this.storage.getDelayedJobs(queueName, now);
              promotedJobs = [];

              for (const job of readyJobs) {
                try {
                  await this.storage.moveJobToQueue(queueName, job.id, 'active');
                  promotedJobs.push(job);
                } catch (error) {
                  console.error(`[promoter] Error promoting job ${job.id}:`, error);
                }
              }
            }

            if (promotedJobs.length === 0) {
              break;
            }

            promotedAny = true;
            promotedCount += promotedJobs.length;

            for (const job of promotedJobs) {
              this.lifecycleEvents?.emit({
                type: 'job.promoted',
                queueName,
                jobId: job.id,
                jobName: job.name,
              });

              await Promise.all(
                promotionHooks.map((plugin) => plugin.onJobPromoted!(job))
              );
            }

            if (promotedJobs.length < ScheduledJobPromoter.PROMOTION_BATCH_LIMIT) {
              break;
            }
          }

          if (typeof this.storage.getNextDelayedTimestamp === 'function') {
            const queueNextDue = await this.storage.getNextDelayedTimestamp(queueName);
            if (queueNextDue != null && (nextDueAt == null || queueNextDue < nextDueAt)) {
              nextDueAt = queueNextDue;
            }
          }
        } catch (error) {
          console.error(`[promoter] Error processing queue ${queueName}:`, error);
        } finally {
          if (this.diagnosticsEnabled()) {
            queueStats.push({
              queueName,
              promotedCount,
              durationMs: Math.max(0, Date.now() - queueStartedAt),
            });
          }
        }
      })
    );

    return {
      promotedAny,
      queueStats,
      ...(nextDueAt != null ? { nextDelayMs: Math.max(0, nextDueAt - now) } : {}),
    };
  }
}
