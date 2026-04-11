---
title: Plugins and Lifecycle
description: Observe and extend every stage of job execution with Vasto's plugin hooks.
outline: deep
---

# Plugins and Lifecycle

Plugins are plain objects that implement the `Plugin` interface. Attach them globally (all queues) or per-queue. Every hook is optional — implement only what you need.

## Plugin interface

```ts
interface Plugin {
  name?: string;

  // Core execution lifecycle
  onEnqueue?(job: Job): Promise<void>;
  onProcessStart?(job: StoredJob): Promise<void>;
  onProcessEnd?(job: StoredJob, result: any): Promise<void>;
  onFail?(job: StoredJob, error: Error): Promise<void>;
  onFailedPermanently?(job: StoredJob, error: Error): Promise<void>;  // after all retries exhausted

  // Scheduling hooks
  onJobDelayed?(job: Job, delayMs: number): Promise<void>;
  onJobPromoted?(job: StoredJob): Promise<void>;        // delayed job becomes ready
  onScheduleCreated?(jobName: string, pattern: string): Promise<void>;

  // Priority hook
  onJobPrioritized?(job: StoredJob): Promise<void>;

  // Progress hook
  onProgress?(jobId: string, queueName: string, progress: number): Promise<void>;
}
```

## A minimal logging plugin

```ts
import type { Plugin } from '@vasto-queue/core';

export const LogPlugin: Plugin = {
  name: 'LogPlugin',

  async onEnqueue(job) {
    console.log(`[enqueue] ${job.constructor.name}`);
  },
  async onProcessStart(job) {
    console.log(`[start]   ${job.name} id=${job.id}`);
  },
  async onProcessEnd(job, result) {
    console.log(`[done]    ${job.name} id=${job.id}`);
  },
  async onFail(job, err) {
    console.error(`[fail]    ${job.name} id=${job.id}`, err.message);
  },
  async onFailedPermanently(job, err) {
    console.error(`[dlq]     ${job.name} id=${job.id} — moved to dead-letter`, err.message);
  },
};
```

## Attaching plugins

### Globally (all queues)

```ts
const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters,
  globalPlugins: [LogPlugin, MetricsPlugin],
});
```

### Per-queue

```ts
const queues = defineQueues({
  payments: {
    name: 'payments',
    connection: 'redis',
    concurrency: 4,
    batchSize: 10,
    plugins: [AuditPlugin],   // only runs for the payments queue
  },
});
```

When both are configured, queue-level plugins run alongside global plugins for that queue.

## Progress reporting

Jobs running with `inline` isolation can report incremental progress back through `this.reportProgress()`:

```ts
export class ProcessCSVJob extends Job<{ fileId: string }> {
  static jobName = 'ProcessCSVJob';
  queue() { return 'data'; }

  async handle({ fileId }) {
    const rows = await loadCSV(fileId);

    for (let i = 0; i < rows.length; i++) {
      await processRow(rows[i]);
      await this.reportProgress(Math.round((i / rows.length) * 100));
    }
  }
}
```

Progress is emitted through `onProgress(jobId, queueName, progress)` on all attached plugins.

::: info Thread/process isolation
`reportProgress()` is a no-op when the job runs in thread or process isolation. Use a shared store (e.g., Redis) to track progress in those modes.
:::

## A metrics plugin example

```ts
import type { Plugin } from '@vasto-queue/core';

export function createMetricsPlugin(metrics: MetricsClient): Plugin {
  return {
    name: 'MetricsPlugin',

    async onEnqueue(job) {
      metrics.increment('vasto.job.enqueued', { job: job.constructor.name });
    },
    async onProcessStart(job) {
      metrics.timing('vasto.job.start', Date.now(), { queue: job.queue });
    },
    async onProcessEnd(job) {
      metrics.increment('vasto.job.completed', { queue: job.queue });
    },
    async onFail(job, err) {
      metrics.increment('vasto.job.failed', { queue: job.queue, error: err.name });
    },
    async onFailedPermanently(job) {
      metrics.increment('vasto.job.dead_letter', { queue: job.queue });
    },
  };
}
```

## Hook execution order

For a given job:

1. `onEnqueue` — at dispatch time, before the job is written to storage
2. `onJobDelayed` — if the job was dispatched with a delay
3. `onJobPromoted` — when a deferred job becomes ready for processing
4. `onProcessStart` — just before `handle()` is called
5. `onProgress` — zero or more times during execution
6. `onProcessEnd` — after `handle()` resolves successfully
7. `onFail` — after a failed attempt (may retry)
8. `onFailedPermanently` — after the final attempt fails and the job moves to dead-letter
