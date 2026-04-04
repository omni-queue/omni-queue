import type { Plugin, StoredJob } from '@vasto/core';

export type JobExecutionStatus = 'completed' | 'failed';

export interface TimingPluginOptions {
  now?: () => number;
  onMeasure?: (
    job: StoredJob,
    durationMs: number,
    status: JobExecutionStatus,
    resultOrError: unknown
  ) => Promise<void> | void;
}

export interface TimedMeasurement {
  job: StoredJob;
  durationMs: number;
  status: JobExecutionStatus;
  resultOrError: unknown;
}

export function TimingPlugin(options: TimingPluginOptions = {}): Plugin {
  const now = options.now ?? Date.now;
  const startedAt = new Map<string, number>();

  const measure = async (
    job: StoredJob,
    status: JobExecutionStatus,
    resultOrError: unknown
  ) => {
    const start = startedAt.get(job.id);
    if (start == null) return;

    startedAt.delete(job.id);
    await options.onMeasure?.(job, now() - start, status, resultOrError);
  };

  return {
    name: 'TimingPlugin',
    async onProcessStart(job) {
      startedAt.set(job.id, now());
    },
    async onProcessEnd(job, result) {
      await measure(job, 'completed', result);
    },
    async onFail(job, error) {
      await measure(job, 'failed', error);
    },
  };
}
