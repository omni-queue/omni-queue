---
title: Core Concepts
description: Understand the building blocks of the Vasto runtime — Supervisor, JobManager, JobRegistry, and configuration.
outline: deep
---

# Core Concepts

Vasto is built around four cooperating objects. Understanding how they relate makes every other piece of the documentation easier to follow.

## The Job class

All work starts with a job class. A job:

- extends `Job<TPayload>` from `@vasto/core`
- declares a **unique** `static jobName` string used for registry lookup
- implements `handle(payload)` where the actual work happens
- optionally overrides `queue()`, `retries()`, `backoff()`, `isolation()`, and `tags()`

```ts
import { Job } from '@vasto/core';

export class ResizeImageJob extends Job<{ imageId: string; width: number }> {
  static jobName = 'ResizeImageJob';

  queue() { return 'media'; }
  retries() { return 5; }
  backoff(attempt: number) { return Math.min(1000 * 2 ** attempt, 30_000); }

  async handle({ imageId, width }) {
    // resize logic
  }
}
```

::: warning Static jobName is required
If a job class does not declare `static jobName`, registration will throw. If two classes share the same name, the second registration also throws.
:::

## JobRegistry

`JobRegistry` is a name → class map. The runtime uses it to look up which class to instantiate when dequeuing a stored job.

```ts
import { JobRegistry } from '@vasto/core';

const registry = new JobRegistry();
registry.register(ResizeImageJob);
registry.register(SendEmailJob);

// or in bulk
registry.registerAll([ResizeImageJob, SendEmailJob, GenerateReportJob]);
```

Every job class must be registered **before** `supervisor.start()` is called.

## defineQueues / defineWorkers

These are thin helper functions that return plain typed objects. There is no magic — they exist only to provide type inference on the config shape.

```ts
import { defineQueues, defineWorkers } from '@vasto/core';

const queues = defineQueues({
  emails: {
    name: 'emails',
    connection: 'redis',      // key into storageAdapters
    concurrency: 10,
    batchSize: 20,
    maxAttempts: 3,
    retry: {
      attempts: 3,
      maxAttempts: 3,
      backoff: 'exponential',
      delay: 1000,
    },
  },
  media: {
    name: 'media',
    connection: 'redis',
    concurrency: 4,
    batchSize: 4,
    executionTimeoutMs: 60_000,
    timeoutStrategy: 'retry',
  },
});

const workers = defineWorkers({
  main: {
    queues: ['emails', 'media'],
    concurrency: 4,
    isolation: 'inline',       // 'inline' | 'thread' | 'process'
  },
});
```

::: tip connection key
The value of `connection` must match a key in the `storageAdapters` map passed to `Supervisor`. This is how Vasto knows which backend serves which queue.
:::

## Supervisor

`Supervisor` is the top-level orchestrator. It owns worker lifecycle, scaling, queue health, scheduling recovery, and (optionally) the dashboard.

```ts
import { Supervisor } from '@vasto/core';
import { RedisQueueStorage } from '@vasto/redis-store';

const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters: {
    redis: new RedisQueueStorage({ host: 'localhost', port: 6379 }),
  },
  globalPlugins: [LogPlugin, MetricsPlugin],
});

await supervisor.start();          // begins polling workers
supervisor.pauseQueue('emails');   // backpressure control
supervisor.resumeQueue('emails');
await supervisor.stop();           // graceful drain
```

The `Supervisor` exposes `supervisor.jobManager` for dispatching work.

## JobManager

`JobManager` is the dispatch and execution surface. You interact with it to enqueue jobs, schedule recurring work, and manage flows or batches.

```ts
const { jobManager } = supervisor;

// Fire-and-forget
await jobManager.dispatch(new SendEmailJob({ to: '...', subject: '...' }));

// Delayed
await jobManager.dispatch(new SendEmailJob(...), { delayMs: 5_000 });

// Priority
await jobManager.dispatch(new SendEmailJob(...), { priority: 'high' });

// Scheduled (cron)
await jobManager.schedule(new DailyReportJob(), { pattern: '0 6 * * *', durable: true });

// One-time future run
await jobManager.schedule(new ReminderJob(), { runAt: Date.now() + 3_600_000 });

// Interval
await jobManager.schedule(new HeartbeatJob(), { intervalMs: 30_000 });
```

## How the pieces fit together

```
┌─────────────────────────────────────────┐
│               Supervisor                │
│  ┌─────────────┐   ┌─────────────────┐  │
│  │  JobManager │   │  Worker pool(s) │  │
│  │  dispatch() │   │  inline/thread/ │  │
│  │  schedule() │   │  process        │  │
│  └──────┬──────┘   └────────┬────────┘  │
│         │                   │           │
│  ┌──────▼───────────────────▼────────┐  │
│  │          QueueStorage             │  │
│  │  (Redis / Postgres / File / …)    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

`JobManager` writes to storage. Workers read from the same storage, claim jobs with lease semantics, execute them, and write the outcome back.
