# Phase 7: Durable Event Queue

**Goal**: Implement a durable, distributed event queue pipeline so Vasto lifecycle events can be reliably delivered to external integrations, persisted for replay, and processed with the same reliability guarantees as first-class jobs.

## Overview

Phase 6 focuses on scaling and enterprise features within the job execution plane. Phase 7 extends Vasto's event surface from the current in-memory lifecycle bus into a durable, queryable event queue:

1. **Event envelope contract** — normalized event shape for all lifecycle transitions.
2. **Event bridge plugin** — maps plugin hooks to event envelopes and routes to a dedicated queue.
3. **Persistent event workers** — persist envelopes to durable storage and publish to downstream sinks.
4. **Replay API** — cursor-based pagination over the persisted event log.
5. **Reliability controls** — retry policy, DLQ, idempotency, backoff.
6. **Multi-tenant and policy controls** — tenant-scoped filtering, PII minimization, retention (optional stretch).

Reference blueprint: [Event Queue Implementation Plan](../event-queue-implementation-plan.md)

---

## Phase 7.1 — Contract + Plumbing (2-3 weeks)

### Objective

Define the normalized event envelope and wire the event bridge plugin that routes core lifecycle transitions into the `system.events` queue.

### Tasks

- [ ] **7.1.1** Define `QueueLifecycleEnvelope` type in `packages/core/src/interfaces/event-envelope.ts`
  - Fields: `eventId`, `eventType`, `occurredAt`, `queueName`, `jobId`, `jobName`, `attempt`, `progress`, `error`, `result`, `correlationId`, `traceId`, `version`
- [ ] **7.1.2** Create `EventBridgePlugin` in `packages/core/src/libs/event-bridge-plugin.ts`
  - Hook into `onEnqueue`, `onProcessStart`, `onProcessEnd`, `onFail`, `onProgress`
  - Builds envelope from hook arguments
  - Dispatches to configured `system.events` queue
  - Supports event type allowlist filter
- [ ] **7.1.3** Add `eventQueue` config option to `SupervisorOptions`
  - Optional: `{ queueName: string; eventTypes?: QueueLifecycleEventType[] }`
  - Bootstrap wires `EventBridgePlugin` if option is set
- [ ] **7.1.4** Write unit tests: `packages/core/tests/event-bridge.test.ts`
  - Envelopes are emitted for core transitions
  - Non-allowlisted events are not dispatched
  - No regression in normal job throughput (benchmark comparison)

### Files (new)

- `packages/core/src/interfaces/event-envelope.ts`
- `packages/core/src/libs/event-bridge-plugin.ts`
- `packages/core/tests/event-bridge.test.ts`

### Files (modified)

- `packages/core/src/interfaces/index.ts` — export `event-envelope.ts`
- `packages/core/src/libs/supervisor.ts` — read `eventQueue` config, bootstrap plugin
- `packages/core/src/index.ts` — export `EventBridgePlugin`

### Acceptance Criteria

- [ ] Events for `job.enqueued`, `job.started`, `job.completed`, `job.failed` are visible in `system.events`.
- [ ] Event type allowlist filtering works as configured.
- [ ] No regression in normal job throughput (automated benchmark).
- [ ] All new code passes `npm --workspace @vasto-queue/core run build && npm --workspace @vasto-queue/core run test`.

---

## Phase 7.2 — Durable Persistence + Replay (3-4 weeks)

### Objective

Persist event envelopes to durable storage and expose a replay API so consumers can recover from restarts or replay historical events over arbitrary windows.

### Tasks

- [ ] **7.2.1** Design storage schema for event persistence
  - `events(event_id, event_type, occurred_at, queue_name, job_id, payload_json, metadata_json, status)`
  - `event_delivery(event_id, sink, attempts, last_error, next_retry_at, delivered_at)`
  - Indexes: `occurred_at`, `(event_type, occurred_at)`, `(status, next_retry_at)`
- [ ] **7.2.2** Implement `EventPersistJob` in `packages/core/src/libs/event-persist-job.ts`
  - Receives a `QueueLifecycleEnvelope`
  - Writes to the configured event store via `QueueStorage` extension hook
- [ ] **7.2.3** Extend `QueueStorage` interface with optional event log methods
  - `persistEvent(envelope): Promise<void>`
  - `queryEvents(opts: EventQueryOptions): Promise<EventPage>`
  - `markEventDelivered(eventId, sink): Promise<void>`
  - Keep additions optional so existing adapters are not broken
- [ ] **7.2.4** Implement replay query API on `Supervisor`
  - `supervisor.queryEvents(opts)` — cursor-based, paginated
  - Options: `fromTimestamp`, `toTimestamp`, `eventTypes[]`, `cursor`, `limit`
- [ ] **7.2.5** Write persistence + replay tests: `packages/core/tests/event-persistence.test.ts`
  - Events survive simulated process restart (in-memory adapter reset)
  - Replay returns consistent ordering by `occurred_at` + tie-breaker `event_id`
  - Cursor pagination produces no duplicates or gaps

### Files (new)

- `packages/core/src/libs/event-persist-job.ts`
- `packages/core/src/interfaces/event-store.ts` (query options and page types)
- `packages/core/tests/event-persistence.test.ts`

### Files (modified)

- `packages/core/src/interfaces/queue-storage.ts` — optional event log methods
- `packages/core/src/libs/supervisor.ts` — `queryEvents()` public API
- `packages/core/src/index.ts` — export `EventPersistJob`, query types

### Acceptance Criteria

- [ ] Events survive process restarts across supported store adapters.
- [ ] Replay returns consistent `occurred_at` + `event_id` ordering.
- [ ] Cursor pagination produces no duplicates or gaps across pages.
- [ ] Existing adapters (in-memory, Redis, Postgres, MySQL, Mongo, DynamoDB) compile and pass tests with no changes.

---

## Phase 7.3 — External Publishing + DLQ Hardening (2-3 weeks)

### Objective

Add publisher workers for delivering events to external sinks (webhooks, streams), apply event-specific retry and DLQ rules, and add operational metrics to monitor the event pipeline health.

### Tasks

- [ ] **7.3.1** Define `EventSink` interface in `packages/core/src/interfaces/event-sink.ts`
  - `deliver(envelope: QueueLifecycleEnvelope): Promise<void>`
  - Implementations: `WebhookSink`, `StreamSink` (interface only in core; implementations optional)
- [ ] **7.3.2** Implement `EventPublishJob` in `packages/core/src/libs/event-publish-job.ts`
  - Reads configured sinks from queue/supervisor config
  - Calls `sink.deliver(envelope)`, converts failures to retryable errors
  - Applies event-specific max attempts and backoff
- [ ] **7.3.3** Wire event DLQ route for `system.events` queue
  - Max attempts and DLQ queue name configurable in `eventQueue` supervisor option
  - Failed event envelopes routed to `system.events.dlq`
- [ ] **7.3.4** Add event pipeline metrics
  - Counters: `event.dispatched`, `event.persisted`, `event.published`, `event.failed`, `event.dlq`
  - Gauges: `event.lag_ms` (time from `occurredAt` to `delivered_at`)
  - Surface via `@vasto-queue/metrics` (existing Prometheus/StatsD exporters)
- [ ] **7.3.5** Write retry/DLQ + publish tests: `packages/core/tests/event-publish.test.ts`
  - Sink failures trigger retry with backoff
  - Exhausted retries are routed to DLQ
  - DLQ jobs are inspectable via supervisor DLQ API

### Files (new)

- `packages/core/src/interfaces/event-sink.ts`
- `packages/core/src/libs/event-publish-job.ts`
- `packages/core/tests/event-publish.test.ts`

### Files (modified)

- `packages/core/src/libs/supervisor.ts` — wire DLQ config for event queue
- `packages/metrics/src/index.ts` — add event pipeline metric keys

### Acceptance Criteria

- [ ] Failed downstream sends are retried with configured backoff.
- [ ] Exhausted retries are routed to `system.events.dlq`.
- [ ] DLQ jobs are inspectable and reprocessable via existing supervisor DLQ API.
- [ ] Lag metric (`event.lag_ms`) is reported and visible in Prometheus output.

---

## Phase 7.4 — Multi-Tenant Policy Controls (Optional / Stretch)

### Objective

Enable tenant-aware event filtering, PII data minimization, and configurable retention/archival policies for compliance-grade deployments.

### Tasks

- [ ] **7.4.1** Tenant-scoped event filtering
  - `EventBridgePlugin` reads tenant context from job metadata
  - Per-tenant allowlist of event types; default policy inherits global allowlist
- [ ] **7.4.2** PII data minimization
  - Define `EventRedactionPolicy` type: map of `eventType → (payload) => sanitizedPayload`
  - Apply redaction in `EventBridgePlugin` before dispatch
- [ ] **7.4.3** Retention and archival policies
  - Config: `retentionDays` per event class or global default
  - Background cleanup job: `EventRetentionJob` purges events past retention window
  - Archive hook: optionally move to cold store (interface only; adapter per storage backend)
- [ ] **7.4.4** Tests: `packages/core/tests/event-policy.test.ts`
  - Verify tenant filtering isolates event sets
  - Verify redaction removes configured fields
  - Verify retention job removes events past configured threshold

### Files (new)

- `packages/core/src/interfaces/event-policy.ts`
- `packages/core/src/libs/event-retention-job.ts`
- `packages/core/tests/event-policy.test.ts`

### Acceptance Criteria

- [ ] Tenants only access authorized event data.
- [ ] Redaction policies strip configured fields before persistence.
- [ ] Retention policies are enforceable and auditable.

---

## Example Integration (Post-Phase 7.1)

```ts
import { Supervisor, EventBridgePlugin } from '@vasto-queue/core';

const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters,
  eventQueue: {
    queueName: 'system.events',
    eventTypes: ['job.completed', 'job.failed', 'job.deadlettered'],
    maxAttempts: 5,
    dlqName: 'system.events.dlq',
  },
});

// Replay last 100 events for a queue
const page = await supervisor.queryEvents({
  queueName: 'email',
  eventTypes: ['job.failed'],
  limit: 100,
});
```

---

## Phase 7 Success Metrics

| Metric | Target |
|--------|--------|
| At-least-once delivery guarantee | Yes |
| Event idempotency support | Yes |
| End-to-end lag (dispatch → persisted) | < 500 ms p99 |
| Replay cursor correctness | No duplicates / no gaps |
| DLQ visibility | Inspectable + replayable via existing CLI/API |
| Storage adapter compatibility | All 6 existing adapters pass CI |

---

## Dependencies

- Phase 5.5 sandbox/retry contracts already in place — event jobs can reuse retry policy hooks.
- `@vasto-queue/metrics` already ships Prometheus/StatsD exporters — add event metric keys directly.
- Existing DLQ routing (Phase 1.4) already handles `maxAttempts` + DLQ queue wiring — no new infrastructure.
- Dashboard WebSocket layer (Phase 2.2) already streams lifecycle events — Phase 7.3 replay endpoint can extend the same handler.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Duplicate delivery | `eventId` + sink-side idempotency key |
| Out-of-order processing | Ordering key + replay sort guarantee |
| Throughput impact on primary queues | Dedicated event queue workers with separate concurrency config |
| Sensitive payload leakage | Phase 7.4 redaction policies; envelope `result`/`error` fields are stripped by default |
