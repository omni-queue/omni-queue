---
title: Migration
description: Migrate to Vasto from BullMQ or another job queue library.
outline: deep
---

# Migration

## From BullMQ

Vasto's API is designed to feel familiar to BullMQ users while offering a more explicit, type-safe model.

### Concept mapping

| BullMQ | Vasto | Notes |
|---|---|---|
| `new Queue('name')` | `defineQueues({ name: { … } })` | Queue config is declarative, not imperative |
| `queue.add('job', data)` | `jobManager.dispatch(new MyJob(data))` | Replace string names with typed classes |
| `new Worker('name', async job => …)` | `class MyJob extends Job { handle() }` | Logic lives in the job class |
| `QueueEvents` | `Plugin` hooks | `onEnqueue`, `onProcessStart`, `onFail`, … |
| `FlowProducer` | `jobManager.dispatchFlow(…)` | Explicit `dependsOn` DAG |
| Repeatable jobs | `jobManager.schedule(…)` | Cron, interval, or one-time |
| `job.moveToFailed()` | Dead-letter via `maxAttempts` or poison policy | Auto after configured failure count |

### Migration steps

1. **Install Vasto** alongside your existing BullMQ setup
2. **Map one queue at a time** — convert one queue's processor to a Vasto `Job` class
3. **Register and dispatch** through `jobManager.dispatch()` for that queue
4. **Validate** failure and retry behavior in staging before moving production traffic
5. **Repeat** for remaining queues, then remove BullMQ

::: tip Start with a non-critical queue
Pick a low-risk queue (notifications, analytics events) for your first migration. This lets you validate the runtime without risking revenue-critical paths.
:::

### Key differences to plan around

::: details Retry semantics
Vasto retries are controlled by `job.retries()`, `job.backoff()`, and optionally a per-queue `retry` policy. The equivalent of BullMQ's `attempts` option is `maxAttempts` on the queue config or directly in the `retry` block.
:::

::: details Repeatable jobs
BullMQ repeatables are configured in `queue.add()` options. In Vasto, use `jobManager.schedule()` with `pattern` (cron), `intervalMs`, or `runAt`. Set `durable: true` to persist the schedule across process restarts.
:::

::: details Connection model
BullMQ takes a Redis connection on the `Queue` and `Worker` constructors. Vasto takes named storage adapters on `Supervisor`. If you are moving to a non-Redis backend, this is the opportunity.
:::

## Full migration guide

For a detailed walkthrough including per-feature parity notes:

- [Migrating from BullMQ](https://github.com/vastohq/vasto/blob/develop/docs/operations/migration-guides/from-bullmq.md)
- [BullMQ compatibility assessment](https://github.com/vastohq/vasto/blob/develop/docs/operations/migration-guides/bullmq-parity-assessment.md)

## Framework quickstarts

Once your jobs are migrated, wire Vasto into your existing HTTP app:

- [Hono](https://github.com/vastohq/vasto/blob/develop/docs/operations/quickstarts/hono-adapter.md)
- [Express](https://github.com/vastohq/vasto/blob/develop/docs/operations/quickstarts/express-adapter.md)
- [Fastify](https://github.com/vastohq/vasto/blob/develop/docs/operations/quickstarts/fastify-adapter.md)
- [NestJS](https://github.com/vastohq/vasto/blob/develop/docs/operations/quickstarts/nest-adapter.md)
- [Elysia](https://github.com/vastohq/vasto/blob/develop/docs/operations/quickstarts/elysia-adapter.md)
- [Next.js](https://github.com/vastohq/vasto/blob/develop/docs/operations/quickstarts/next-adapter.md)
