# Implemented Feature Catalog

This catalog is the canonical, implementation-focused inventory of capabilities currently shipped across the Vasto monorepo.

## Core Runtime

### Queue lifecycle and orchestration

- Supervisor-managed worker lifecycle, queue ownership, and scaling orchestration.
- Registry-driven class jobs (`JobRegistry`) with typed payload support.
- Queue dispatch primitives: immediate, delayed (`delayMs`, `delayUntil`), scheduled (`runAt`, `intervalMs`, `pattern` + `timezone`).
- Queue administration APIs: pause/resume, drain, clean, obliterate, promote/remove, queue depth inspection.

### Execution model

- Isolation modes: `inline`, `thread`, `process`.
- Pooled thread/process execution with generated isolation modules.
- Visibility leasing with lease extension heartbeat and timeout handling.
- Execution timeout controls (`executionTimeoutMs`, `timeoutStrategy`, `timeoutSignal`).

### Retry and failure handling

- Configurable attempts (`maxAttempts`, queue retry settings, `Job.retries()`).
- Backoff controls:
  - legacy fixed/exponential
  - per-job hook (`Job.backoff(attempt)`)
  - queue strategy naming: `fixed`, `exponential`, `full-jitter`, `equal-jitter`, `decorrelated-jitter`
  - `delay`, `maxDelay`, `jitter`
- Error-aware retry decisions:
  - per-job `retryPolicy(error, context)`
  - queue-level retry rules (`when.name`, `when.code`, `when.messageIncludes`, `when.timeout`)
  - decision actions: `retry`, `fail`, `deadletter`.
- Dead-letter queue support with replay/retry operations.
- Poison-message policy templates: `quarantine`, `auto-snooze`, `escalation`.

### Rate limiting and reliability controls

- Queue-level rate limiting.
- Per-consumer rate limiting (`rateLimit.perConsumer`).
- Local token-bucket coordinator for non-distributed storage backends.
- Optional distributed/global limiter primitive (`consumeRateLimitToken`) in storage contract.
- Backpressure controls (`depthThreshold`, `resumeThreshold`, `mode`, `checkIntervalMs`).
- Circuit breaker controls (`failureThreshold`, `cooldownMs`, `halfOpenMaxInFlight`, `tripOnTimeout`).

### Sandboxing and security controls

- Sandbox policy contract (`sandbox`) with filesystem/environment/network/child-process controls.
- Enforced sandbox for thread/process isolation execution.
- Inline execution is rejected when sandbox policy is enabled.
- Policy options: env allowlist, cwd allowlist, network allowlist, deny network, deny child-process spawn, read-only filesystem.

### Workflows, batch, and progress

- DAG job flows with dependency tracking and atomic-failure behavior.
- Batch job composition and result aggregation.
- Progress reporting via `reportProgress()` + storage-backed progress updates.
- Lifecycle event stream with queue/worker/job transitions.

### Idempotency and archival

- Idempotency key support with deduplication windows.
- Completed-job archive support and retention policy hooks.

## Storage Adapters

Implemented adapters:

- `@vasto/redis-store`
- `@vasto/postgres-store`
- `@vasto/mysql-store`
- `@vasto/mongo-store`
- `@vasto/dynamodb-store`
- in-memory storage in `@vasto/core`

Notable capabilities:

- Shared `QueueStorage` contract across backends.
- Delayed/deferred job queries and promotion behavior.
- Active/ready/completed/dead-letter query surfaces.
- Redis adapter supports distributed atomic token consumption for queue + consumer rate limiting.

## Dashboard and API

- First-party dashboard UI package (`@vasto/dashboard`).
- Dashboard API package (`@vasto/dashboard-api`) with HTTP server/request-handler/middleware integration patterns.
- RBAC model (`viewer`, `operator`, `admin`) and scoped auth contracts.
- Tenant-aware filtering strategy for operator-facing endpoints and streams.
- Real-time monitoring and operational controls.

## Framework Adapters

Official adapters:

- Express (`@vasto/express-adapter`)
- Next.js (`@vasto/next-adapter`)
- Fastify (`@vasto/fastify-adapter`)
- Nest (`@vasto/nest-adapter`)
- Hono (`@vasto/hono-adapter`)
- Elysia (`@vasto/elysia-adapter`) — HTTP/static integration with native Bun WebSocket live updates (`/ws`), plus optional polling fallback.

## CLI and Developer Tooling

Implemented CLI surfaces (`@vasto/cli`):

- `queue init`
- `vasto generate job`
- `vasto generate api-job`
- `vasto generate workflow`
- `vasto generate scheduled`
- `vasto generate isolation`
- `queue monitor`
- `queue dlq:list`
- `queue dlq:retry`
- `queue dlq:retry-all`
- `queue workers:list`
- `queue dashboard`
- `queue dev`
- `queue start`

## Observability and Telemetry

- Metrics package (`@vasto/metrics`) with exporters and runtime collection hooks.
- OpenTelemetry plugin package (`@vasto/otel-plugin`).
- Lifecycle event stream and replay-oriented operator visibility.

## Examples and executable references

### Core runtime

- `examples/queue-system`: queue + worker + plugin composition baseline.
- `examples/workflow-system`: multi-step job flow with `reportProgress`, fan-out, and chained queues.
- `examples/scheduling-lab`: `scheduledAt` / cron-style deferred dispatch and run-at semantics.

### Reliability and safety controls

- `examples/reliability-lab`: retries, custom `retryPolicy` (deadletter on validation errors), exponential backoff.
- `examples/idempotency-lab`: `dedupeWindowMs` + `includeFailed` idempotency key deduplication.
- `examples/timeout-sandbox-lab`: `executionTimeoutMs`, `timeoutStrategy: 'fail'`, sandbox policy rejection.
- `examples/poison-policy-lab`: all three poison templates — quarantine, auto-snooze, and escalation.

### Operational visibility

- `examples/archive-lab`: `getCompletedJobs`, `queryJobArchive` filters, `setArchiveRetentionPolicy`, `cleanJobs`.
- `examples/metrics-lab`: `QueueMetricsPlugin`, `MetricsCollector`, Prometheus / StatsD / DataDog exporters.
- `examples/queue-admin-lab`: queue admin operations — pause, resume, flush, priority reordering.

### Storage backends

- `examples/redis-isolation`: Redis-backed isolated execution and dashboard flow (process/thread pool wiring).
- `examples/postgres-storage-lab`: `PostgresStore` with `migrate()` + Supervisor + dispatch + completed-job read.
- `examples/mysql-storage-lab`: `MySqlStore` wiring with connection pool and env-gated bootstrap.
- `examples/mongo-storage-lab`: `MongoStore` wiring with `MongoClient` + `dbName` configuration.
- `examples/dynamodb-storage-lab`: `DynamoDbStore` with `region`, local endpoint override, and table config.

### Framework adapters and dashboard integration

- `examples/next-dashboard-app`: Next.js Pages Router — catch-all dashboard route + job dispatch API route.
- `examples/elysia-dashboard-app`: Elysia — `registerElysiaAdapter` + job dispatch endpoint (port 3020).
- `examples/fastify-dashboard-app`: Fastify + `@fastify/middie` + `vastoFastifyAdapter` (port 3030).
- `examples/hono-dashboard-app`: Hono + `@hono/node-server` + `vastoHonoAdapter` (port 3040).
- `examples/nest-dashboard-app`: NestJS — `vastoNestAdapter` middleware + decorated controller (port 3050).

### Reference apps

- `examples/api-server`: REST API + queue integration pattern — canonical request-driven dispatch reference.
- `examples/dashboard`: dashboard-focused operational UX without a framework adapter.

## Coverage completeness checklist

Use this checklist when validating whether runnable examples cover the implemented feature surface.

- Core runtime behavior (dispatch, scheduling, workflow, retries, DLQ, queue admin).
- Reliability and safety controls (idempotency, timeout strategy, sandbox policy, poison policy).
- Operational visibility (archive queries, metrics exporters, dashboard integration).
- Storage backends (in-memory, Redis, Postgres, MySQL, MongoDB, DynamoDB).
- Framework adapters (Next, Elysia, Fastify, Hono, Nest).

For the canonical mapping from each feature area to concrete runnable projects, see the Feature coverage matrix in [quickstarts/README.md](quickstarts/README.md).

## Notes on scope

This catalog documents implemented features, not planned features. For future work and sequencing, use [ROADMAP](ROADMAP.md).

For a future implementation blueprint on durable queue events, see [Event Queue Implementation Plan](event-queue-implementation-plan.md).
