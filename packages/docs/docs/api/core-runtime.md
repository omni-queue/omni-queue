---
title: Core Runtime API
description: Supervisor, JobManager, JobRegistry, defineQueues, defineWorkers, Job — full API reference.
outline: deep
---

# Core Runtime API

## Job <Badge type="info" text="abstract class" />

The base class all job classes must extend.

```ts
import { Job } from '@vasto-queue/core';

export class MyJob extends Job<{ id: string }> {
  static jobName = 'MyJob';

  // Required
  async handle(payload: { id: string }): Promise<void> { /* … */ }

  // Optional overrides
  queue(): string                    { return 'default'; }
  retries(): number                  { return 3; }
  backoff(attempt: number): number   { return Math.min(1000 * 2 ** attempt, 30_000); }
  isolation(): IsolationType         { return 'inline'; }
  tags(): string[]                   { return []; }
}
```

| Member | Type | Description |
|---|---|---|
| `static jobName` | `string` | **Required.** Unique registry key. |
| `handle(payload)` | `Promise<any>` | **Required.** Job logic. |
| `queue()` | `string` | Queue name. Defaults to `'default'`. |
| `retries()` | `number` | Max retry count. Defaults to `3`. |
| `backoff(attempt)` | `number` | Backoff delay in ms. Defaults to capped exponential. |
| `isolation()` | `IsolationType` | Per-job isolation override. Defaults to `'inline'`. |
| `tags()` | `string[]` | Metadata tags stored with the job. |
| `reportProgress(n)` | `Promise<void>` | Reports 0–100 progress (inline isolation only). |

---

## JobRegistry <Badge type="tip" text="class" />

```ts
import { JobRegistry } from '@vasto-queue/core';

const registry = new JobRegistry();
```

| Method | Signature | Description |
|---|---|---|
| `register` | `(jobClass: JobConstructor) => void` | Register a single job class. Throws on duplicate `jobName`. |
| `registerAll` | `(jobs: JobConstructor[]) => void` | Bulk registration. |
| `get` | `(name: string) => JobConstructor` | Look up a class by name. Throws if not found. |
| `has` | `(name: string) => boolean` | Check if a name is registered. |

---

## defineQueues / defineWorkers <Badge type="tip" text="function" />

Identity helpers that return typed config objects. Required only for TypeScript inference.

```ts
import { defineQueues, defineWorkers } from '@vasto-queue/core';

const queues = defineQueues({ /* Record<string, QueueConfig> */ });
const workers = defineWorkers({ /* Record<string, WorkerConfig> */ });
```

### QueueConfig

```ts
interface QueueConfig {
  name: string;
  connection: string;           // key into storageAdapters
  concurrency: number;
  batchSize: number;
  priority?: QueuePriority;
  maxAttempts?: number;
  executionTimeoutMs?: number;  // per-job execution timeout
  timeoutStrategy?: 'retry' | 'fail';
  retry?: {
    attempts: number;
    maxAttempts: number;
    backoff: 'exponential' | 'fixed';
    delay?: number;
    strategyName?: 'fixed' | 'exponential' | 'full-jitter' | 'equal-jitter' | 'decorrelated-jitter';
    jitter?: number;
    maxDelay?: number;
  };
  rateLimit?: {
    capacity: number;
    refillRate: number;
    perConsumer?: { capacity: number; refillRate: number };
  };
  idempotency?: {
    dedupeWindowMs?: number;
    includeFailed?: boolean;
  };
  reliability?: QueueReliabilityConfig;  // backpressure + circuit breaker
  sandbox?: QueueSandboxConfig;          // process isolation sandbox
  plugins?: Plugin[];
}
```

### WorkerConfig

```ts
interface WorkerConfig {
  queues: string[];
  concurrency: number;
  isolation?: 'inline' | 'thread' | 'process';  // default: 'inline'
  workerModule?: string;    // required for thread/process
  registryModule?: string;  // required for thread/process
  pluginsModule?: string;
  poolSize?: number;
  balancing?: 'round-robin' | 'least-loaded';
  timeout?: number;
  consumerId?: string;
}
```

---

## Supervisor <Badge type="tip" text="class" />

```ts
import { Supervisor } from '@vasto-queue/core';

const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters,
  globalPlugins?,
  dashboard?,
  repeatables?,
});
```

### Properties

| Property | Type | Description |
|---|---|---|
| `jobManager` | `JobManager` | Dispatch and scheduling surface. |

### Methods

| Method | Signature | Description |
|---|---|---|
| `start` | `(mode?: SupervisorMode) => Promise<void>` | Start workers and scheduling. Mode: `'worker'` \| `'api'` \| `'hybrid'`. Default: `'worker'`. |
| `stop` | `() => Promise<void>` | Gracefully drain and stop all workers. |
| `pauseQueue` | `(queueName: string) => boolean` | Stop polling a queue without stopping workers. |
| `resumeQueue` | `(queueName: string) => boolean` | Resume a paused queue. |
| `scaleWorker` | `(name: string, config: WorkerConfig) => void` | Adjust worker pool size at runtime. |
| `getReliabilityStatus` | `(queueName: string) => QueueReliabilityStatus \| undefined` | Get circuit breaker and backpressure state. |

---

## JobManager <Badge type="tip" text="class" />

Accessed via `supervisor.jobManager`.

### dispatch()

```ts
await jobManager.dispatch(job, options?);
```

#### DispatchOptions {#dispatch-options}

```ts
interface DispatchOptions {
  delayMs?: number;           // delay execution by N ms
  delayUntil?: number;        // delay until specific timestamp (ms)
  priority?: 'critical' | 'high' | 'normal' | 'low';
  idempotencyKey?: string;    // prevent duplicate dispatches
  tags?: string[];
}
```

### schedule()

```ts
const handle = await jobManager.schedule(job, options);
await handle.stop(); // cancel the schedule
```

Exactly **one** of `pattern`, `intervalMs`, or `runAt` must be provided.

```ts
interface ScheduleOptions {
  pattern?: string;        // cron pattern (e.g. '0 6 * * *')
  intervalMs?: number;     // repeat every N ms
  runAt?: number;          // one-time run at timestamp
  durable?: boolean;       // persist schedule across restarts (default: true)
}
```

### dispatchFlow()

Dispatch a DAG of jobs where nodes execute only after their dependencies complete.

```ts
await jobManager.dispatchFlow({
  id: 'my-flow',
  nodes: [
    { id: 'fetch',   job: new FetchDataJob() },
    { id: 'process', job: new ProcessDataJob(), dependsOn: ['fetch'] },
    { id: 'notify',  job: new NotifyJob(),      dependsOn: ['process'] },
  ],
});
```

### dispatchBatch()

```ts
const batchId = await jobManager.dispatchBatch('my-batch', [
  new ProcessItemJob({ id: '1' }),
  new ProcessItemJob({ id: '2' }),
  new ProcessItemJob({ id: '3' }),
]);
```

- `register(JobClass)`
- `resolve(jobName)`

## Queue and Worker Declarations

- `defineQueues(queueConfigMap)`
- `defineWorkers(workerConfigMap)`

## Important Types

- `QueueStorage`
- `Plugin`
- `QueueConfig`
- `WorkerConfig`

## Practical Construction

```ts
const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters,
  globalPlugins,
  dashboard
});
```
