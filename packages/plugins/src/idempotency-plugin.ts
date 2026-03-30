import type { Plugin, StoredJob } from '@omni-queue/core';

export type IdempotencyState = 'processing' | 'done';

export interface IdempotencyStore {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: IdempotencyState): Promise<void>;
}

export function IdempotencyPlugin(store: IdempotencyStore): Plugin {
  return {
    name: 'IdempotencyPlugin',

    async onProcessStart(job: StoredJob) {
      if (!job.idempotencyKey) return;

      const exists = await store.get(job.idempotencyKey);

      if (exists === 'done') {
        throw new Error('Skip duplicate');
      }

      await store.set(job.idempotencyKey, 'processing');
    },

    async onProcessEnd(job: StoredJob) {
      if (job.idempotencyKey) {
        await store.set(job.idempotencyKey, 'done');
      }
    },
  };
}
