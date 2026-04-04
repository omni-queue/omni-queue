# Event Queue Implementation Plan

This document outlines how to implement a durable event queue capability in Vasto, with behavior comparable to BullMQ and bee-queue event workflows.

## Goal

Provide two complementary event surfaces:

1. Real-time lifecycle subscriptions for operational UIs and short-lived listeners.
2. Durable event queue processing for integrations, audit trails, and replay.

## Current Baseline (Already Available)

Vasto already has an in-memory lifecycle event stream and plugin hooks:

1. Lifecycle event bus and recent-event replay.
2. Supervisor-level subscription APIs.
3. Runtime-emitted job/queue/worker lifecycle events.
4. Plugin hook points (`onEnqueue`, `onProcessStart`, `onProcessEnd`, `onFail`, `onProgress`, etc.).

Current limitation:

1. Built-in lifecycle history is process-local and bounded in memory.
2. It is not a durable distributed event log on its own.

## Target Outcome

Implement a durable event-queue pipeline where lifecycle events are transformed into event jobs and processed by dedicated workers.

Expected behavior:

1. At-least-once event delivery.
2. Event idempotency support for consumers.
3. Retry + DLQ policy for failed event processing.
4. Replayability from persisted event storage.

## Proposed Architecture

### 1. Event envelope contract

Define a normalized envelope for all emitted events:

1. `eventId` (unique ID)
2. `eventType` (ex: `job.completed`)
3. `occurredAt` (timestamp)
4. `queueName`, `jobId`, `jobName`
5. `attempt`, `progress`, `error`, `result` (as applicable)
6. `correlationId` / `traceId` (optional)
7. `version` (schema version)

### 2. Event producer layer

Create an event bridge plugin that maps runtime hooks to event envelopes and dispatches to a dedicated queue, for example `system.events`.

Responsibilities:

1. Filter event types by config (allowlist).
2. Enrich with metadata (tenant, env, source worker).
3. Add idempotency key derived from `eventId`.

### 3. Event queue and worker

Create one or more dedicated workers for event handling:

1. `EventPersistJob`: persist envelopes to durable store.
2. `EventPublishJob`: publish to downstream targets (webhook, stream, bus).
3. `EventProjectJob` (optional): maintain read models for UI.

### 4. Consumer-facing APIs

Expose event access patterns:

1. Replay API by `fromTimestamp` / `cursor`.
2. Queue/topic filtering by event type.
3. Optional subscription bridge (WebSocket/SSE) from persisted stream.

### 5. Reliability controls

For event jobs, enable:

1. Explicit retry policy.
2. Dead-letter queue for poison events.
3. Backoff strategy and max attempts.
4. Idempotent write path in sinks.

## Implementation Phases

### Phase 1: Contract + plumbing

Deliverables:

1. Event envelope type definitions.
2. Event queue configuration and bootstrap wiring.
3. Bridge plugin emitting `job.enqueued`, `job.started`, `job.completed`, `job.failed`.

Acceptance criteria:

1. Events are visible in `system.events` queue for core lifecycle transitions.
2. No regression in normal job throughput.

### Phase 2: Durable persistence + replay

Deliverables:

1. Event persistence worker and storage schema.
2. Replay query API with pagination/cursors.

Acceptance criteria:

1. Events survive process restarts.
2. Replay returns consistent ordering by timestamp + tie-breaker ID.

### Phase 3: External publishing and DLQ hardening

Deliverables:

1. Publisher worker (webhook/stream adapter interface).
2. Event-specific retry and DLQ rules.
3. Operational metrics for lag/failure/retry counts.

Acceptance criteria:

1. Failed downstream sends are retried and eventually DLQ'd.
2. Operators can inspect and reprocess failed event jobs.

### Phase 4: Multi-tenant and policy controls (optional)

Deliverables:

1. Tenant-scoped event filtering.
2. PII/data minimization policies per event type.
3. Retention and archival policies by tenant/event class.

Acceptance criteria:

1. Tenants only access authorized event data.
2. Retention policies are enforceable and auditable.

## Data Model Recommendation

For persistent storage (example logical schema):

1. `events(event_id, event_type, occurred_at, queue_name, job_id, payload_json, metadata_json, status)`
2. `event_delivery(event_id, sink, attempts, last_error, next_retry_at, delivered_at)`

Indexes:

1. `occurred_at` for replay windows.
2. `(event_type, occurred_at)` for filtered replay.
3. `(status, next_retry_at)` for retry scanning.

## Operational Checklist

Before rollout:

1. Define event schema versioning strategy.
2. Define consumer idempotency semantics.
3. Configure retry budget and DLQ thresholds.
4. Add dashboards: event throughput, lag, failure rate, DLQ depth.

After rollout:

1. Run backpressure/circuit tests with downstream outages.
2. Validate replay correctness against sampled production intervals.
3. Perform chaos testing for duplicate and out-of-order event handling.

## Risks and Mitigations

1. Duplicate delivery.
   1. Mitigation: event ID + sink-side idempotency key.
2. Out-of-order processing.
   1. Mitigation: ordering key and replay sort guarantees.
3. Throughput impact on primary queues.
   1. Mitigation: isolate event queue workers/resources.
4. Sensitive payload leakage.
   1. Mitigation: redact/minimize payload fields before emit.

## Minimal MVP Scope

Implement first:

1. Event bridge plugin for core lifecycle events.
2. Single persistent sink worker.
3. Replay endpoint with cursor pagination.
4. Retry + DLQ for event processing.
