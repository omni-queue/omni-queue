# Phase 1.1 Implementation Summary — Delayed & Scheduled Jobs

**Date**: 2026-03-29  
**Scope**: Current implementation status across `core`, storage adapters, and examples.

## Executive Summary

Phase 1.1 is **largely implemented**. Core delayed job support, storage adapter gating, scheduled promotion, a working scheduling API for `runAt`, fixed intervals, and cron patterns, and a Redis-backed example are in place. Remaining work is primarily operational hardening of live integration coverage and ongoing observability in CI.

## What Is Implemented

### 1) Core data model and dispatch options

- `StoredJob` includes delayed/scheduling fields:
  - `delayUntil?`
  - `scheduledCron?`
  - `lastScheduledAt?`
- `DispatchOptions` includes:
  - `delayMs?`
  - `delayUntil?`
  - `jobId?`
  - `idempotencyKey?`

Files:
- `packages/core/src/types.ts`

### 2) QueueStorage contract extension

The `QueueStorage` interface now requires delayed/scheduled primitives:

- `getDelayedJobs(queueName, beforeDate)`
- `moveJobToQueue(queueName, jobId, toState)`
- `queryDeferredJobs(query)`

Files:
- `packages/core/src/interfaces/queue-storage.ts`

### 3) Job dispatch and schedule flow support delayed and scheduled jobs

`JobManager.dispatch(...)` now:

- Calculates `delayUntil` from either `options.delayUntil` or `Date.now() + options.delayMs`
- Emits `onJobDelayed` plugin hook when delay is present
- Persists `delayUntil` into `StoredJob` when applicable

`JobManager.schedule(...)` now:

- Supports one-time `runAt` scheduling via delayed dispatch materialization
- Supports recurring `intervalMs` schedules via timers
- Supports recurring cron `pattern` schedules via `node-cron`
- Emits `onScheduleCreated` plugin hook
- Stores `scheduledCron` / `lastScheduledAt` metadata for recurring scheduled dispatches
- Returns a schedule handle with `stop()` for recurring schedules

Files:
- `packages/core/src/libs/worker-runtime.ts`

### 4) Scheduled promoter implemented and wired into supervisor

`ScheduledJobPromoter` exists and:

- Polls on interval (default `1000ms`)
- Calls `storage.getDelayedJobs(queueName, now)`
- Promotes each ready job with `storage.moveJobToQueue(queueName, job.id, 'active')`
- Emits `onJobPromoted` plugin hook

`Supervisor` now:

- Starts promoter on `start()`
- Stops promoter on `stop()`
- Exposes `queryDeferredJobs(...)` to inspect deferred jobs across configured queues/storage adapters

Files:
- `packages/core/src/libs/scheduled-job-promoter.ts`
- `packages/core/src/libs/supervisor.ts`

### 5) Plugin API expanded for Phase 1.1

Plugin interface contains:

- `onJobDelayed(job, delayMs)`
- `onJobPromoted(job)`
- `onScheduleCreated(jobName, pattern)`

Files:
- `packages/core/src/interfaces/plugin.ts`

### 6) Adapter status

#### In-memory adapter (functional baseline)

Implements:

- `getDelayedJobs`
- `moveJobToQueue`
- `queryDeferredJobs`
- Prevents delayed jobs from being dequeued before promotion

Files:
- `packages/core/src/libs/in-memory-queue-storage.ts`

#### Redis adapter (implemented for delayed/deferred basics)

Current state:

- Uses a dedicated deferred sorted set for delayed jobs
- Implements `getDelayedJobs`
- Implements `moveJobToQueue`
- Implements `queryDeferredJobs`
- Includes deferred jobs in queue depth calculations
- Ensures only `queued` delayed jobs are promotable
- Keeps failed deferred jobs queryable via deferred status filters

Files:
- `packages/redis-store/src/redis-store.ts`

#### File adapter used by API example (now aligned)

`FileQueueStorage` now implements all required delayed/deferred methods:

- `getDelayedJobs`
- `moveJobToQueue`
- `queryDeferredJobs`
- Prevents delayed jobs from being claimed before promotion

Files:
- `examples/api-server/src/storage/file-queue-storage.ts`

#### Postgres adapter

`PostgresStore` now:

- Persists delayed/scheduling metadata
- Implements `getDelayedJobs`
- Implements `moveJobToQueue`
- Implements `queryDeferredJobs`
- Excludes delayed jobs from normal dequeue until promotion clears `delay_until`

Files:
- `packages/postgres-store/src/postgres-store.ts`

#### Redis isolation example

The Redis-backed example API now includes a scheduling endpoint for email jobs:

- delayed dispatch via `delayMs`
- one-time scheduling via `runAt`
- recurring interval scheduling via `intervalMs`
- recurring cron scheduling via `pattern` + optional `timezone`
- recurring schedules are stopped during API shutdown

Files:
- `examples/redis-isolation/src/server.ts`
- `examples/redis-isolation/README.md`

### 7) Automated test coverage added

Added focused unit coverage for delayed job behavior:

- dispatch persists `delayUntil`
- `onJobDelayed` hook fires
- delayed jobs are not dequeueable before promotion
- `ScheduledJobPromoter` promotes ready jobs
- `onJobPromoted` hook fires
- promoted jobs become dequeueable afterward

Added focused unit coverage for scheduling behavior:

- `runAt` schedules materialize as delayed jobs
- `intervalMs` schedules dispatch repeatedly until stopped
- cron schedules register through `node-cron`
- cron-triggered dispatches include `scheduledCron` metadata

Added focused supervisor coverage for deferred inspection behavior:

- deferred jobs aggregate across configured queues
- `pending`/`promoted`/`failed` status filters are supported
- queue-scoped and paginated deferred queries behave as expected

Added focused adapter coverage for Redis delayed/deferred behavior:

- delayed enqueue lands in deferred tracking
- promotion flow moves jobs to active/dequeueable state
- failed deferred jobs remain queryable via `status: 'failed'`

Added focused adapter coverage for Postgres delayed/deferred behavior:

- delayed jobs are excluded from normal dequeue until promotion
- due delayed jobs are returned for promotion
- pending/promoted/failed deferred filters behave as expected

Added opt-in live integration coverage for Redis and Postgres:

- Redis integration verifies delayed enqueue, promotion, and dequeue against a real Redis instance
- Postgres integration verifies delayed gating and promotion against a real PostgreSQL instance
- Integration suites are gated by environment variables to keep default test runs fast and deterministic
- GitHub Actions workflow added to run integration suites with Redis/Postgres service containers

Files:
- `packages/core/tests/delayed-jobs.test.ts`
- `packages/core/tests/scheduling.test.ts`
- `packages/core/tests/supervisor-deferred.test.ts`
- `packages/redis-store/tests/redis-store-delayed.test.ts`
- `packages/redis-store/tests/redis-store.integration.test.ts`
- `packages/postgres-store/tests/postgres-store-delayed.test.ts`
- `packages/postgres-store/tests/postgres-store.integration.test.ts`
- `.github/workflows/integration-tests.yml`

## What Is Not Yet Complete

1. **Live integration suites require external services and env setup** (`RUN_INTEGRATION_TESTS`, `REDIS_TEST_URL`, `PG_TEST_URL`) when run outside CI.
2. **Live integration reliability in CI should be observed and tuned** (timeouts/retries) as test runtime data accumulates.

## Validation Snapshot

Command executed:

- `npm run check-types`
- `cd packages/core && npm test -- tests/delayed-jobs.test.ts`
- `cd packages/core && npm test -- tests/scheduling.test.ts tests/delayed-jobs.test.ts`
- `cd packages/core && npm test -- tests/supervisor-deferred.test.ts tests/delayed-jobs.test.ts tests/scheduling.test.ts`
- `cd packages/redis-store && npm test -- tests/redis-store-delayed.test.ts`
- `cd packages/postgres-store && npm test -- tests/postgres-store-delayed.test.ts`
- `RUN_INTEGRATION_TESTS=true REDIS_TEST_URL=redis://127.0.0.1:6379 cd packages/redis-store && npm run test:integration`
- `RUN_INTEGRATION_TESTS=true PG_TEST_URL=postgres://user:pass@127.0.0.1:5432/db cd packages/postgres-store && npm run test:integration`

Result after adapter alignment in `examples/api-server`, `packages/postgres-store`, and `packages/redis-store`:

- ✅ `examples/api-server` type mismatch against `QueueStorage` is resolved.
- ✅ `PostgresStore` now implements delayed/deferred `QueueStorage` methods.
- ✅ `RedisStore` now implements delayed/deferred storage semantics for promotion/query flows.
- ✅ Added focused passing tests for delayed dispatch and promotion behavior.
- ✅ Added focused passing tests for `runAt`, interval, and cron scheduling behavior.
- ✅ Added focused passing tests for supervisor deferred-job inspection APIs.
- ✅ Added focused passing tests for Redis delayed/deferred adapter behavior.
- ✅ Added focused passing tests for Postgres delayed/deferred adapter behavior.
- ✅ Added opt-in live integration tests for Redis and Postgres delayed/scheduled flows.
- ✅ Added a CI workflow to run live integration tests against Redis/Postgres service containers.
- ✅ Redis isolation example now demonstrates delayed and scheduled job submission.
- ✅ Workspace `npm run check-types` now passes with zero TypeScript errors.

## Current Position Against Roadmap

- Roadmap declares Phase 1.1 as **IN PROGRESS** with implementation items now checked.
- Technical design document status has been updated to reflect implemented core-path support.

Files:
- `docs/operations/ROADMAP.md`
- `docs/operations/phase-1/delayed-jobs-design.md`

## Recommended Next Actions

1. Run/monitor the new integration workflow in CI and tune timeouts/retries if needed.
2. Add lightweight dashboards/alerts for integration test flakiness trends.
