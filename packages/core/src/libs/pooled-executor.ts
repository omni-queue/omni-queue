/* eslint-disable @typescript-eslint/no-explicit-any */

interface PrioritizedTask {
  task: () => Promise<any>;
  /** Lower value = higher urgency (matches PRIORITY_SCORES: critical=0 … low=3). */
  priority: number;
  sequence: number;
}

/**
 * Concurrency-bounded executor with priority ordering.
 * When concurrency is saturated, tasks are queued by priority so the
 * highest-urgency task is dispatched as soon as a slot becomes free.
 */
export class PooledExecutor {
  private queue: PrioritizedTask[] = [];
  private active = 0;
  private sequence = 0;

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
        sequence: this.sequence++,
        task: async () => {
          try {
            const result = await task();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        },
      };

      this.heapPush(entry);

      this.runNext();
    });
  }

  private runNext() {
    if (this.active >= this.concurrency) return;
    const entry = this.heapPop();
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

  private compare(left: PrioritizedTask, right: PrioritizedTask): number {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.sequence - right.sequence;
  }

  private heapPush(entry: PrioritizedTask): void {
    this.queue.push(entry);
    let index = this.queue.length - 1;

    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (this.compare(this.queue[parent]!, this.queue[index]!) <= 0) {
        break;
      }

      [this.queue[parent], this.queue[index]] = [this.queue[index]!, this.queue[parent]!];
      index = parent;
    }
  }

  private heapPop(): PrioritizedTask | undefined {
    if (this.queue.length === 0) {
      return undefined;
    }

    if (this.queue.length === 1) {
      return this.queue.pop();
    }

    const root = this.queue[0]!;
    this.queue[0] = this.queue.pop()!;

    let index = 0;
    const lastIndex = this.queue.length - 1;

    while (true) {
      const left = (index << 1) + 1;
      const right = left + 1;
      let smallest = index;

      if (left <= lastIndex && this.compare(this.queue[left]!, this.queue[smallest]!) < 0) {
        smallest = left;
      }

      if (right <= lastIndex && this.compare(this.queue[right]!, this.queue[smallest]!) < 0) {
        smallest = right;
      }

      if (smallest === index) {
        break;
      }

      [this.queue[index], this.queue[smallest]] = [this.queue[smallest]!, this.queue[index]!];
      index = smallest;
    }

    return root;
  }
}
