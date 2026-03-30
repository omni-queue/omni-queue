/* eslint-disable @typescript-eslint/no-explicit-any */

interface PrioritizedTask {
  task: () => Promise<any>;
  /** Lower value = higher urgency (matches PRIORITY_SCORES: critical=0 … low=3). */
  priority: number;
}

/**
 * Concurrency-bounded executor with priority ordering.
 * When concurrency is saturated, tasks are queued by priority so the
 * highest-urgency task is dispatched as soon as a slot becomes free.
 */
export class PooledExecutor {
  private queue: PrioritizedTask[] = [];
  private active = 0;

  constructor(private concurrency: number) {}

  /**
   * Submit a task.
   * @param task    Async function to execute.
   * @param priority Numeric priority (lower = sooner). Defaults to 2 (normal).
   */
  async submit(task: () => Promise<any>, priority = 2) {
    return new Promise((resolve, reject) => {
      const entry: PrioritizedTask = {
        priority,
        task: async () => {
          try {
            const result = await task();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        },
      };

      // Insert in sorted position (ascending priority = highest urgency first)
      let lo = 0;
      let hi = this.queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (this.queue[mid]!.priority <= entry.priority) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      this.queue.splice(lo, 0, entry);

      this.runNext();
    });
  }

  private runNext() {
    if (this.active >= this.concurrency) return;
    const entry = this.queue.shift();
    if (!entry) return;

    this.active++;
    entry
      .task()
      .catch(() => {})
      .finally(() => {
        this.active--;
        this.runNext();
      });
  }
}
