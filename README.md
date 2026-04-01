# omni-queue

**A superior BullMQ alternative with Laravel Horizon's operational excellence.**

Omni-queue is a TypeScript-first job queue system that gives you flexible worker isolation, pluggable storage backends, and an auto-scaling supervisor — all out of the box.

[![CI](https://github.com/omni-queue/omni-queue/actions/workflows/ci.yml/badge.svg)](https://github.com/omni-queue/omni-queue/actions)
[![npm](https://img.shields.io/npm/v/@omni-queue/core)](https://www.npmjs.com/package/@omni-queue/core)

## Documentation Hub

- [Implemented feature catalog](docs/operations/feature-catalog.md)
- [Operations roadmap](docs/operations/ROADMAP.md)
- [Documentation index](docs/operations/README.md)
- [BullMQ migration guide](docs/operations/migration-guides/from-bullmq.md)
- [Adapter quickstarts](docs/operations/quickstarts/README.md)
- [Dashboard integration guide](docs/operations/quickstarts/dashboard-integration.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Release process](docs/operations/releasing.md)
- [Changelog](CHANGELOG.md)

## Adoption Paths

Choose the entry point that matches your use case:

- **Evaluating Omni Queue against BullMQ:** start with the [BullMQ Parity Assessment](docs/operations/migration-guides/bullmq-parity-assessment.md) then the [migration guide](docs/operations/migration-guides/from-bullmq.md)
- **Building an HTTP-triggered queue flow:** use the [adapter quickstarts](docs/operations/quickstarts/README.md)
- **Scaffolding new jobs quickly:** use the CLI starter generators below
- **Planning production rollout:** review the [operations roadmap](docs/operations/ROADMAP.md) and phase docs

---

## Key Differentiators

| Feature | BullMQ | omni-queue |
|---------|--------|------------|
| **Worker Isolation** | Sandboxed only | **Flexible: inline / thread / process** |
| **Storage Backends** | Redis only | **Pluggable: Redis, Postgres, MySQL, MongoDB, DynamoDB, In-memory** |
| **Auto-scaling Supervisor** | ❌ | **✅ Built-in** |
| **Delayed & Scheduled Jobs** | ✅ | **✅ runAt / intervalMs / cron** |
| **Job Priorities** | ✅ | **✅ critical / high / normal / low** |
| **Plugin System** | Via events | **✅ First-class lifecycle hooks** |
| **Dashboard** | Bull Board (3rd-party) | **✅ First-party dashboard + API package** |

---

## Packages

| Package | Description |
|---------|-------------|
| [`@omni-queue/core`](packages/core) | Core runtime: supervisor, job manager, in-memory storage |
| [`@omni-queue/cli`](packages/cli) | Project scaffolding, job generators, monitoring, and DLQ commands |
| [`@omni-queue/metrics`](packages/metrics) | Metrics collector, exporters, and auto-collection plugin |
| [`@omni-queue/redis-store`](packages/redis-store) | Redis (ioredis) storage adapter |
| [`@omni-queue/postgres-store`](packages/postgres-store) | Postgres (`pg`) storage adapter |
| [`@omni-queue/mysql-store`](packages/mysql-store) | MySQL storage adapter |
| [`@omni-queue/mongo-store`](packages/mongo-store) | MongoDB storage adapter |
| [`@omni-queue/dynamodb-store`](packages/dynamodb-store) | DynamoDB storage adapter |
| [`@omni-queue/dashboard-api`](packages/dashboard-api) | Shared dashboard API primitives (routes, auth, websocket binding, config resolution) |
| [`@omni-queue/dashboard`](packages/dashboard) | First-party dashboard frontend |
| [`@omni-queue/express-adapter`](packages/express-adapter) | Express adapter (`createExpressAdapter`, `createExpressWebSocketBinding`) |
| [`@omni-queue/next-adapter`](packages/next-adapter) | Next.js integration |
| [`@omni-queue/fastify-adapter`](packages/fastify-adapter) | Fastify integration |
| [`@omni-queue/nest-adapter`](packages/nest-adapter) | Nest integration |
| [`@omni-queue/hono-adapter`](packages/hono-adapter) | Hono integration |
| [`@omni-queue/elysia-adapter`](packages/elysia-adapter) | Elysia/Bun integration |
| [`@omni-queue/otel-plugin`](packages/otel-plugin) | OpenTelemetry tracing plugin |
| [`@omni-queue/plugins`](packages/plugins) | Built-in plugins: DAG, rate-limiter |

---

## Quick Start

```bash
npm install @omni-queue/core
```

```typescript
import {
  InMemoryQueueStorage,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@omni-queue/core';

// 1. Define a job
class SendEmailJob {
  static jobName = 'SendEmailJob';
  constructor(public payload: { to: string; subject: string }) {}
  queue() { return 'emails'; }
}

// 2. Set up infrastructure
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

// 3. Dispatch jobs
await supervisor.jobManager.dispatch(new SendEmailJob({ to: 'hello@example.com', subject: 'Hi!' }));

// 4. Start processing
await supervisor.start();
```

### CLI starters

Use the CLI to generate production-oriented starter files:

```bash
queue generate job --name=send-email
queue generate api-job --name=send-email
queue generate workflow --name=asset-pipeline
queue generate scheduled --name=daily-digest
```

These templates are intended to give new adopters a clean starting point for typed jobs, HTTP-triggered background work, DAG-style workflows, and scheduled execution.

---

## Dispatch Options

### Immediate dispatch

```typescript
await jobManager.dispatch(new MyJob(payload));
```

### Delayed dispatch

```typescript
// Delay by duration
await jobManager.dispatch(new MyJob(payload), { delayMs: 5000 });

// Delay until exact time
await jobManager.dispatch(new MyJob(payload), { delayUntil: Date.now() + 60_000 });
```

### Priority dispatch

```typescript
// Priorities: 'critical' | 'high' | 'normal' | 'low'
await jobManager.dispatch(new MyJob(payload), { priority: 'critical' });
await jobManager.dispatch(new MyJob(payload), { priority: 'low' });
```

Critical jobs are always dequeued before high, which are dequeued before normal and low — regardless of creation order.

### Scheduled dispatch

```typescript
// One-time future run
await jobManager.schedule(new MyJob(payload), { runAt: Date.now() + 3_600_000 });

// Recurring interval
await jobManager.schedule(new MyJob(payload), { intervalMs: 60_000 });

// Cron pattern
await jobManager.schedule(new MyJob(payload), {
  pattern: '0 9 * * *',      // daily at 9 AM
  timezone: 'America/New_York',
});
```

---

## Storage Backends

### In-memory (development / testing)

```typescript
import { InMemoryQueueStorage } from '@omni-queue/core';
const storage = new InMemoryQueueStorage();
```

### Redis

```typescript
import { RedisStore } from '@omni-queue/redis-store';
const storage = new RedisStore({ client: { host: 'localhost', port: 6379 } });
```

### Postgres

```typescript
import { PostgresStore } from '@omni-queue/postgres-store';
const storage = new PostgresStore({ pool: { connectionString: process.env.DATABASE_URL } });
await storage.migrate(); // create tables
```

---

## Plugin System

```typescript
import type { Plugin } from '@omni-queue/core';

const LogPlugin: Plugin = {
  name: 'LogPlugin',
  async onEnqueue(job)       { console.log('enqueued', job.jobName); },
  async onProcessStart(job)  { console.log('started',  job.name); },
  async onProcessEnd(job)    { console.log('done',     job.name); },
  async onFail(job, err)     { console.error('failed', job.name, err); },
  async onJobDelayed(job, ms){ console.log('delayed',  job.jobName, ms); },
  async onJobPromoted(job)   { console.log('promoted', job.name); },
  async onJobPrioritized(job){ console.log('priority', job.name, job.priority); },
};
```

---

## Implemented Features (Consolidated)

For a complete and continuously updated list of implemented capabilities (runtime behavior, reliability/security controls, dashboard/auth, storage adapters, framework adapters, and CLI surfaces), see:

- [Feature catalog](docs/operations/feature-catalog.md)
- [Core package README](packages/core/README.md)

---

## Running Tests

```bash
# Unit tests (no external services required)
npm test

# Integration tests (requires Redis + Postgres)
REDIS_TEST_URL=redis://localhost:6379 \
PG_TEST_URL=postgres://user:pass@localhost:5432/test \
RUN_INTEGRATION_TESTS=true \
npm run test:integration
```

## CI Workflows

Two GitHub Actions workflows protect `main`:

- `CI` (`.github/workflows/ci.yml`): install, build, typecheck, and monorepo test sweep.
- `Integration Tests` (`.github/workflows/integration-tests.yml`): Redis + Postgres adapter integration validation when core/storage paths change.

You can run the same checks locally with `npm run build`, `npm run check-types`, `npm test`, and `npm run test:integration`.

---

## Examples

| Example | Description |
|---------|-------------|
| [`examples/api-server`](examples/api-server) | Two-process API producer + worker consumer using file-based storage |
| [`examples/queue-system`](examples/queue-system) | Multi-queue system with plugins and workers |
| [`examples/redis-isolation`](examples/redis-isolation) | Redis-backed HTTP API with delayed + scheduled dispatch |
| [`examples/workflow-system`](examples/workflow-system) | DAG workflow + batch + one-time scheduling in a focused in-memory project |
| [`examples/reliability-lab`](examples/reliability-lab) | Retry/backoff policy, DLQ operations, queue pause/resume/drain, and reliability snapshot |
| [`examples/scheduling-lab`](examples/scheduling-lab) | Delayed, runAt, interval, and cron scheduling with deferred query/promotion |
| [`examples/queue-admin-lab`](examples/queue-admin-lab) | Queue status, promotion/removal, cleaning, and obliteration admin operations |
| [`examples/idempotency-lab`](examples/idempotency-lab) | Idempotency key deduplication behavior across in-flight and completed windows |
| [`examples/timeout-sandbox-lab`](examples/timeout-sandbox-lab) | Execution timeout fail strategy and sandbox-policy enforcement behavior |
| [`examples/poison-policy-lab`](examples/poison-policy-lab) | Quarantine, auto-snooze, and escalation poison-message policy behaviors |
| [`examples/archive-lab`](examples/archive-lab) | Completed-job archive queries, filtering, and cleanup flows |
| [`examples/metrics-lab`](examples/metrics-lab) | Runtime metrics collection plus Prometheus, StatsD, and DataDog export formats |
| [`examples/postgres-storage-lab`](examples/postgres-storage-lab) | Postgres-backed queue storage with migrations and completed-job reads |
| [`examples/mysql-storage-lab`](examples/mysql-storage-lab) | MySQL-backed queue storage with migrations and completed-job reads |
| [`examples/mongo-storage-lab`](examples/mongo-storage-lab) | MongoDB-backed queue storage with migrations and completed-job reads |
| [`examples/dynamodb-storage-lab`](examples/dynamodb-storage-lab) | DynamoDB-backed queue storage with migrate-and-run workflow |
| [`examples/next-dashboard-app`](examples/next-dashboard-app) | Next.js dashboard adapter app with API-route dispatch and dashboard catch-all |
| [`examples/elysia-dashboard-app`](examples/elysia-dashboard-app) | Elysia dashboard adapter app with HTTP dispatch and mounted dashboard routes |
| [`examples/fastify-dashboard-app`](examples/fastify-dashboard-app) | Fastify dashboard adapter app with middleware mounting and queue API route |
| [`examples/hono-dashboard-app`](examples/hono-dashboard-app) | Hono dashboard adapter app with Node server bridge and queue API route |
| [`examples/nest-dashboard-app`](examples/nest-dashboard-app) | Nest dashboard adapter app with controller dispatch and mounted dashboard middleware |

For guided setup flows, see [docs/operations/quickstarts/README.md](docs/operations/quickstarts/README.md).

---

## Roadmap

See [docs/operations/ROADMAP.md](docs/operations/ROADMAP.md) for the full evolution plan.

For migration and onboarding material, see [docs/operations/README.md](docs/operations/README.md).

---

## Contributing

PRs welcome. Please run `npm test` and `npm run check-types` before submitting.

## License

MIT
