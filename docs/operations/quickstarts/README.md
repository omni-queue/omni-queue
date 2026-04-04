# Adapter & Feature Quickstarts

Use this page as the single copy-paste cookbook for core runtime features and adapter entrypoints.

## Available adapter quickstarts

- [Express adapter](express-adapter.md)
- [Next adapter](next-adapter.md)
- [Fastify adapter](fastify-adapter.md)
- [Nest adapter](nest-adapter.md)
- [Hono adapter](hono-adapter.md)
- [Elysia adapter](elysia-adapter.md)
- [Dashboard integration](dashboard-integration.md)

## Runnable example projects

- [`examples/api-server`](../../../examples/api-server): API producer + dedicated worker with file storage
- [`examples/queue-system`](../../../examples/queue-system): multi runtime with plugins and dashboard API
- [`examples/redis-isolation`](../../../examples/redis-isolation): Redis producer/worker split with inline/thread/process isolation
- [`examples/workflow-system`](../../../examples/workflow-system): workflow DAG + batch + schedule walkthrough
- [`examples/reliability-lab`](../../../examples/reliability-lab): retries, DLQ, queue controls, and reliability snapshot
- [`examples/scheduling-lab`](../../../examples/scheduling-lab): delayed/runAt/interval/cron schedules with deferred promotion
- [`examples/queue-admin-lab`](../../../examples/queue-admin-lab): status, promote/remove, cleanup, and queue obliteration operations
- [`examples/idempotency-lab`](../../../examples/idempotency-lab): idempotency key dedupe behavior and window expiry
- [`examples/timeout-sandbox-lab`](../../../examples/timeout-sandbox-lab): timeout fail strategy and sandbox-inline mismatch behavior
- [`examples/poison-policy-lab`](../../../examples/poison-policy-lab): quarantine, auto-snooze, and escalation poison-policy behavior
- [`examples/archive-lab`](../../../examples/archive-lab): completed-job archive querying, filtering, and cleanup
- [`examples/metrics-lab`](../../../examples/metrics-lab): runtime metrics collection with exporter format examples
- [`examples/postgres-storage-lab`](../../../examples/postgres-storage-lab): Postgres-backed queue setup and migration pattern
- [`examples/mysql-storage-lab`](../../../examples/mysql-storage-lab): MySQL-backed queue setup and migration pattern
- [`examples/mongo-storage-lab`](../../../examples/mongo-storage-lab): MongoDB-backed queue setup and migration pattern
- [`examples/dynamodb-storage-lab`](../../../examples/dynamodb-storage-lab): DynamoDB-backed queue setup and migration pattern
- [`examples/next-dashboard-app`](../../../examples/next-dashboard-app): Next.js adapter app with queue API routes and dashboard hosting
- [`examples/elysia-dashboard-app`](../../../examples/elysia-dashboard-app): Elysia adapter app with queue routes and dashboard hosting
- [`examples/fastify-dashboard-app`](../../../examples/fastify-dashboard-app): Fastify adapter app with queue routes and dashboard hosting
- [`examples/hono-dashboard-app`](../../../examples/hono-dashboard-app): Hono adapter app with queue routes and dashboard hosting
- [`examples/nest-dashboard-app`](../../../examples/nest-dashboard-app): Nest adapter app with queue routes and dashboard hosting

## Feature coverage matrix

| Feature area | Primary examples |
| --- | --- |
| Baseline runtime + dispatch | `api-server`, `queue-system` |
| Delayed/runAt/interval/cron scheduling | `scheduling-lab`, `redis-isolation` |
| Workflow DAG + batch | `workflow-system` |
| Retry/backoff/retry policy | `reliability-lab` |
| DLQ query/retry | `reliability-lab`, `redis-isolation` |
| Queue admin ops (pause/resume/drain/clean/obliterate) | `queue-admin-lab` |
| Idempotency + dedupe window | `idempotency-lab` |
| Timeout strategy + sandbox enforcement | `timeout-sandbox-lab` |
| Poison-message templates | `poison-policy-lab` |
| Completed archive query + retention hooks | `archive-lab` |
| Metrics collection + exporters | `metrics-lab` |
| Redis backend | `redis-isolation` |
| Postgres backend | `postgres-storage-lab` |
| MySQL backend | `mysql-storage-lab` |
| MongoDB backend | `mongo-storage-lab` |
| DynamoDB backend | `dynamodb-storage-lab` |
| Next adapter app | `next-dashboard-app` |
| Elysia adapter app | `elysia-dashboard-app` |
| Fastify adapter app | `fastify-dashboard-app` |
| Hono adapter app | `hono-dashboard-app` |
| Nest adapter app | `nest-dashboard-app` |

## 1) Minimal baseline (Supervisor + typed jobs)

```ts
import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@vasto/core';

class SendEmailJob extends Job<{ to: string; subject: string; body: string }> {
  static jobName = 'send-email';
  override jobName = SendEmailJob.jobName;

  override queue() {
    return 'emails';
  }

  override async handle(payload: { to: string; subject: string; body: string }) {
    return { accepted: true, to: payload.to };
  }
}

const registry = new JobRegistry();
registry.register(SendEmailJob);

const supervisor = new Supervisor({
  queues: defineQueues({
    emails: { name: 'emails', connection: 'memory', concurrency: 4, batchSize: 10 },
  }),
  workers: defineWorkers({
    main: { queues: ['emails'], concurrency: 2, isolation: 'inline' },
  }),
  registry,
  storageAdapters: { memory: new InMemoryQueueStorage() },
});

await supervisor.start();
```

## 2) Dispatch patterns (immediate, delayed, priority)

```ts
const job = new SendEmailJob({ to: 'hello@example.com', subject: 'Welcome', body: 'Hi!' });

// immediate
await supervisor.jobManager.dispatch(job);

// delayed by duration
await supervisor.jobManager.dispatch(job, { delayMs: 5_000 });

// delayed until timestamp
await supervisor.jobManager.dispatch(job, { delayUntil: Date.now() + 60_000 });

// priority: critical | high | normal | low
await supervisor.jobManager.dispatch(job, { priority: 'critical' });
```

## 3) Scheduling patterns (runAt, interval, cron)

```ts
const reportJob = new SendEmailJob({ to: 'ops@example.com', subject: 'Daily report', body: 'ready' });

// one-time future run
await supervisor.jobManager.schedule(reportJob, { runAt: Date.now() + 3_600_000 });

// recurring fixed interval
await supervisor.jobManager.schedule(reportJob, { intervalMs: 60_000 });

// recurring cron expression
await supervisor.jobManager.schedule(reportJob, {
  pattern: '0 9 * * *',
  timezone: 'America/New_York',
});
```

## 4) Workflow / DAG execution

```ts
import { Job } from '@vasto/core';

class DownloadAssetJob extends Job<{ assetId: string }> {
  static jobName = 'download-asset';
  override jobName = DownloadAssetJob.jobName;
  override queue() { return 'media'; }
  override async handle() { return { downloaded: true }; }
}

class TranscodeAssetJob extends Job<{ assetId: string }> {
  static jobName = 'transcode-asset';
  override jobName = TranscodeAssetJob.jobName;
  override queue() { return 'media'; }
  override async handle() { return { transcoded: true }; }
}

class NotifyAssetReadyJob extends Job<{ assetId: string }> {
  static jobName = 'notify-asset-ready';
  override jobName = NotifyAssetReadyJob.jobName;
  override queue() { return 'notifications'; }
  override async handle() { return { notified: true }; }
}

const flow = await supervisor.dispatchFlow(
  [
    { id: 'download', job: new DownloadAssetJob({ assetId: 'a-123' }) },
    { id: 'transcode', job: new TranscodeAssetJob({ assetId: 'a-123' }), dependsOn: ['download'] },
    { id: 'notify', job: new NotifyAssetReadyJob({ assetId: 'a-123' }), dependsOn: ['transcode'] },
  ],
  { flowId: 'asset-pipeline-a-123', atomicFailure: true }
);

const latestFlowState = supervisor.getFlow(flow.id);
```

## 5) Retries, backoff, and retry policy

```ts
import { Job } from '@vasto/core';

class PaymentCaptureJob extends Job<{ paymentId: string }> {
  static jobName = 'payment-capture';
  override jobName = PaymentCaptureJob.jobName;

  override queue() {
    return 'payments';
  }

  override retries() {
    return 5;
  }

  override backoff(attempt: number) {
    return Math.min(1_000 * 2 ** attempt, 30_000);
  }

  override retryPolicy(error: Error) {
    if (error.message.includes('VALIDATION')) {
      return { action: 'deadletter' };
    }
    return undefined;
  }

  override async handle() {
    // throw to trigger retry handling
    throw new Error('TRANSIENT_GATEWAY_ERROR');
  }
}
```

Queue-level retry policy shape:

```ts
payments: {
  name: 'payments',
  connection: 'memory',
  concurrency: 8,
  batchSize: 20,
  retry: {
    attempts: 5,
    maxAttempts: 5,
    backoff: 'exponential',
    strategyName: 'full-jitter',
    maxDelay: 30_000,
  },
}
```

## 6) Dead letter queue (DLQ) operations

```ts
const failed = await supervisor.getDLQ({ queueName: 'payments', limit: 100 });

if (failed.length > 0) {
  await supervisor.retryDLQ('payments', failed[0]!.id);
}
```

## 7) Queue operations (pause, resume, drain)

```ts
supervisor.pauseQueue('emails');

await supervisor.drainQueue('emails', {
  timeoutMs: 30_000,
  pollIntervalMs: 200,
  pauseFirst: true,
});

supervisor.resumeQueue('emails');
```

## 8) Progress reporting

From inside inline job handlers:

```ts
class ImportCatalogJob extends Job<{ tenantId: string }> {
  static jobName = 'import-catalog';
  override jobName = ImportCatalogJob.jobName;

  override async handle() {
    await this.reportProgress(25);
    await this.reportProgress(60);
    await this.reportProgress(100);
    return { ok: true };
  }
}
```

From external routes/services:

```ts
await supervisor.setJobProgress(jobId, queueName, 80);
```

## 9) Reliability controls (rate-limit, backpressure, circuit breaker)

```ts
emails: {
  name: 'emails',
  connection: 'memory',
  concurrency: 6,
  batchSize: 12,
  rateLimit: {
    capacity: 100,
    refillRate: 100,
    perConsumer: { capacity: 20, refillRate: 20 },
  },
  reliability: {
    backpressure: {
      depthThreshold: 5_000,
      resumeThreshold: 2_500,
      mode: 'delay',
    },
    circuitBreaker: {
      failureThreshold: 20,
      cooldownMs: 30_000,
      halfOpenMaxInFlight: 5,
      tripOnTimeout: true,
    },
  },
}
```

## 10) Isolation & sandbox policy

```ts
workers: defineWorkers({
  isolated: {
    queues: ['emails'],
    concurrency: 2,
    isolation: 'process',
  },
}),

queues: defineQueues({
  emails: {
    name: 'emails',
    connection: 'memory',
    concurrency: 4,
    batchSize: 10,
    sandbox: {
      enabled: true,
      envAllowlist: ['NODE_ENV'],
      denyNetwork: true,
      denyChildProcessSpawn: true,
      readOnlyFilesystem: true,
    },
  },
}),
```

## 11) Dashboard auth configuration

```ts
const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters,
  dashboard: {
    auth: {
      mode: 'custom',
      authenticate: async ({ request }) => {
        const token = request.headers.authorization?.replace('Bearer ', '');
        if (token !== process.env.DASHBOARD_BEARER_TOKEN) return null;
        return { role: 'admin' };
      },
    },
  },
});
```

For Basic Auth style credentials in examples, use `DASHBOARD_AUTH_USERNAME` and `DASHBOARD_AUTH_PASSWORD`.

## 12) CLI starter commands

```bash
vasto generate job --name=send-email
vasto generate api-job --name=send-email
vasto generate workflow --name=asset-pipeline
vasto generate scheduled --name=daily-digest
```

## 13) Observability and lifecycle stream

```ts
const unsubscribe = supervisor.subscribeLifecycleEvents((event) => {
  console.log('[lifecycle]', event.type, event.queueName ?? 'n/a');
});

const reliability = supervisor.getReliabilitySnapshot();
console.log('open circuits:', reliability.openCircuits);

unsubscribe();
```

## Choosing the right starter

- Use **API job** starters when an HTTP request should enqueue work and return quickly.
- Use **workflow** starters when the work has explicit dependency ordering.
- Use **scheduled** starters when recurring maintenance or batch tasks need cron-like execution.

## Next steps

- For BullMQ users, continue with the [migration guide](../migration-guides/from-bullmq.md)
- For production rollout, review the [capacity planning toolkit](../phase-5/capacity-planning-toolkit.md)
- For complete runtime capabilities, review the [feature catalog](../feature-catalog.md)
