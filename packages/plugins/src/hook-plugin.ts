import type { Job, Plugin, StoredJob } from '@omni-queue/core';

export interface HookPluginOptions {
  onEnqueue?(job: Job): Promise<void> | void;
  onProcessStart?(job: StoredJob): Promise<void> | void;
  onProcessEnd?(job: StoredJob, result: unknown): Promise<void> | void;
  onFail?(job: StoredJob, error: Error): Promise<void> | void;
}

export function createHookPlugin(options: HookPluginOptions): Plugin {
  return {
    async onEnqueue(job) {
      await options.onEnqueue?.(job);
    },
    async onProcessStart(job) {
      await options.onProcessStart?.(job);
    },
    async onProcessEnd(job, result) {
      await options.onProcessEnd?.(job, result);
    },
    async onFail(job, error) {
      await options.onFail?.(job, error);
    },
  };
}
