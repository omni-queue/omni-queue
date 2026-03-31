/* eslint-disable @typescript-eslint/no-explicit-any */
import { RetryDecision, RetryDecisionContext } from '../interfaces/retry-policy';

export abstract class Job<T = any> {
  abstract jobName: string;

  payload: T;

  /**
   * Available inside `handle()` when running with inline isolation.
   * Reports job progress (0–100). Wired by the runtime before handle() is called.
   * No-op by default (e.g. for thread/process isolation).
   *
   * @example
   *   await this.reportProgress(50); // 50% done
   */
  reportProgress: (progress: number) => Promise<void> = async () => {
    // no-op by default; replaced by runtime for inline isolation
  };

  constructor(payload: T) {
    this.payload = payload;
  }

  abstract handle(payload: T): Promise<any>;

  retries(): number {
    return 3;
  }

  backoff(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 30000);
  }

  retryPolicy(_error: Error, _context: RetryDecisionContext): RetryDecision | undefined {
    return undefined;
  }

  queue(): string {
    return 'default';
  }

  tags(): string[] {
    return [];
  }

  isolation(): 'thread' | 'process' | 'inline' {
    return 'inline';
  }

  serialize(): { payload: T } {
    return {
      payload: this.payload,
    };
  }
}
