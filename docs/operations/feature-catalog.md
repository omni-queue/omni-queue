# Implemented Feature Catalog

This catalog is the canonical, implementation-focused inventory of capabilities currently shipped across the Omni Queue monorepo.

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
- `@omni-queue/redis-store`
- `@omni-queue/postgres-store`
- `@omni-queue/mysql-store`
- `@omni-queue/mongo-store`
- `@omni-queue/dynamodb-store`
- in-memory storage in `@omni-queue/core`

Notable capabilities:
- Shared `QueueStorage` contract across backends.
- Delayed/deferred job queries and promotion behavior.
- Active/ready/completed/dead-letter query surfaces.
- Redis adapter supports distributed atomic token consumption for queue + consumer rate limiting.

## Dashboard and API

- First-party dashboard UI package (`@omni-queue/dashboard`).
- Dashboard API package (`@omni-queue/dashboard-api`) with HTTP server/request-handler/middleware integration patterns.
- RBAC model (`viewer`, `operator`, `admin`) and scoped auth contracts.
- Tenant-aware filtering strategy for operator-facing endpoints and streams.
- Real-time monitoring and operational controls.

## Framework Adapters

Official adapters:
- Express (`@omni-queue/express-adapter`)
- Next.js (`@omni-queue/next-adapter`)
- Fastify (`@omni-queue/fastify-adapter`)
- Nest (`@omni-queue/nest-adapter`)
- Hono (`@omni-queue/hono-adapter`)
- Elysia (`@omni-queue/elysia-adapter`) — HTTP/static integration with native Bun WebSocket live updates (`/ws`), plus optional polling fallback.

## CLI and Developer Tooling

Implemented CLI surfaces (`@omni-queue/cli`):
- `queue init`
- `queue generate job`
- `queue generate api-job`
- `queue generate workflow`
- `queue generate scheduled`
- `queue generate isolation`
- `queue monitor`
- `queue dlq:list`
- `queue dlq:retry`
- `queue dlq:retry-all`
- `queue workers:list`
- `queue dashboard`
- `queue dev`
- `queue start`

## Observability and Telemetry

- Metrics package (`@omni-queue/metrics`) with exporters and runtime collection hooks.
- OpenTelemetry plugin package (`@omni-queue/otel-plugin`).
- Lifecycle event stream and replay-oriented operator visibility.

## Examples and executable references

- `examples/queue-system`: queue + worker + plugin composition.
- `examples/redis-isolation`: Redis-backed isolated execution and dashboard flow.
- `examples/dashboard`: dashboard-focused operational UX.
- `examples/api-server`: API + queue integration pattern.

## Notes on scope

This catalog documents implemented features, not planned features. For future work and sequencing, use [ROADMAP](ROADMAP.md).
