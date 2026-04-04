# Vasto Evolution Roadmap

**Goal**: Evolve vasto as a production-grade queue runtime inspired by BullMQ and Laravel Horizon's operational excellence.

## Phase 1: Core Job Lifecycle

### Objective
Cover essential BullMQ-style queueing workflows while keeping Vasto's typed and pluggable architecture.

### **Foundation (Pre-1.1)** **[DONE]**
- [x] Core `Supervisor` & `JobManager` orchestration
- [x] `Job` contract with typed payloads
- [x] `JobRegistry` with name-based lookup and instantiation
- [x] `QueueStorage` interface for pluggable backends
- [x] In-memory, Redis, Postgres, MySQL, MongoDB, DynamoDB storage adapters
- [x] Worker isolation modes: inline / thread / process
- [x] Worker and queue configuration and auto-scaling
- [x] Plugin system and lifecycle hooks
- [x] Lifecycle event bus with replay buffer (500-event history)
- [x] Batch job composition and result aggregation
- [x] Job progress reporting via `reportProgress()`
- [x] Completed job archival (Horizon-style history)
- [x] Idempotency key support for deduplication

### 1.1 Delayed & Scheduled Jobs **[DONE]**
- [x] Add delayMs, delayUntil to Job contract
- [x] Extend QueueStorage interface for delayed job queries
- [x] Implement ScheduledJobPromoter background task
- [x] Add cron scheduling support (node-cron)
- [x] Example: Redis isolation with delayed jobs
- [x] Documentation & tests

### 1.2 Job Priorities & Priority Queues **[DONE]**
- [x] Add priority field to StoredJob type
- [x] Implement priority bucket dequeue strategy
- [x] Update PooledExecutor for priority ordering
- [x] Example: Email routing (critical, high, normal, low)

### 1.3 Job Progress Tracking **[DONE]**
- [x] Add setProgress() API to JobManager
- [x] Extend QueueStorage with progress storage
- [x] Add onProgress plugin hook
- [x] Real-time progress updates via plugins

### 1.4 Dead Letter Queue (DLQ) **[DONE]**
- [x] Add maxAttempts to QueueConfig
- [x] Implement DLQ routing in ResilientWorker
- [x] Add getDLQ() supervisor API
- [x] Plugin hook: onFailedPermanently
- [x] Example: Failed job inspection & retry

## Phase 2: Observability & Dashboard

### 2.1 Metrics Collection & Export **[DONE]**
- [x] @vasto/metrics package
- [x] Prometheus client integration
- [x] StatsD & DataDog exporters
- [x] Auto-collected metrics (queue depth, duration, failures)

### 2.2 Web Dashboard (MVP) **[DONE]**
- [x] React + Tailwind UI
- [x] Queue overview & health
- [x] Job list browser with filtering
- [x] Failed job triage & retry UI
- [x] Real-time updates (SSE/WebSocket)
- [x] Worker scaling controls

### 2.3 Job Archive & Audit **[DONE]**
- [x] SQL-based job archive
- [x] Configurable retention policies
- [x] Query builder for historical analysis

## Phase 3: Advanced Features

### 3.1 Job Flows (DAG-based Workflows) **[DONE]**
- [x] JobFlow builder API
- [x] Parent-child dependency tracking
- [x] Atomic failure handling

### 3.2 Queue Pause/Resume with Drain **[DONE]**
- [x] Graceful shutdown logic
- [x] Drain: wait for in-flight jobs
- [x] API: supervisor.pauseQueue(), resumeQueue()

### 3.3 Job Timeout & Cancellation **[DONE]**
- [x] Per-job execution timer
- [x] Signal handling for process workers
- [x] Configurable timeout behavior (kill, retry)

## Phase 4: Ecosystem & Integration

### 4.1 Official Adapters **[DONE]**
- [x] @vasto/mysql-store
- [x] @vasto/postgres-store
- [x] @vasto/mongo-store
- [x] @vasto/dynamodb-store

### 4.2 Framework Integrations **[DONE]**
- [x] @vasto/express-adapter (default via dashboard-api)
- [x] @vasto/next-adapter
- [x] @vasto/fastify-adapter
- [x] @vasto/nest-adapter
- [x] @vasto/hono-adapter

### 4.3 CLI Tooling **[DONE]**
- [x] `vasto init`
- [x] `vasto generate job`
- [x] `vasto monitor`
- [x] `vasto dlq:*` commands

### 4.4 BullMQ Parity Gap Sprint (Pre-Phase 5) **[DONE]**
- [x] Durable repeatable jobs (persisted schedules + restart recovery)
- [x] Idempotency keys and deduplication strategy
- [x] Job administration operations (`promote`, `remove`, `clean`, `obliterate`)
- [x] Unified event stream contract for queue/worker/job lifecycle

## Phase 5: Production Readiness & Adoption

### 5.1 Reliability Hardening **[DONE]**
- [x] Exactly-once/idempotency guidance and helper APIs
- [x] Backpressure and circuit-breaker strategy at queue/worker level
- [x] Poison-message policy templates (quarantine, auto-snooze, escalation)

### 5.2 Security & Multi-Tenancy **[DONE]**
- [x] Dashboard/API RBAC roles (viewer/operator/admin)
- [x] API tokens with scoped permissions and rotation guidance
- [x] Tenant isolation model for queues, DLQ, and metrics boundaries

### 5.3 Operability at Scale **[DONE]**
- [x] SLO-focused dashboards (latency, success rate, recovery time)
- [x] Incident playbooks and runbooks for common failure modes
- [x] Capacity planning toolkit for worker and storage sizing

### 5.4 Developer Adoption & Migration **[DONE]**
- [x] Migration toolkit and compatibility layer from BullMQ
- [x] Framework quickstarts for all official adapters
- [x] Opinionated templates for API jobs, workflow jobs, and scheduled jobs

### 5.5 BullMQ Parity Closure (Hard Gaps) **[DONE]**
- [x] Strict worker sandboxing policy (filesystem/env/network allowlists) for isolated execution
- [x] Custom retry logic surface (error-aware retry strategy hooks)
- [x] Per-job backoff hooks (`Job.backoff(attempt)`) with runtime precedence
- [x] Per-consumer rate limiting (in addition to current queue-level limits)

**Execution checklist (5.5)** **[DONE]**
- [x] Add config contracts for sandbox policy, retry policy, and per-consumer limits
- [x] Wire process-isolation sandbox enforcement path (runtime → isolation → process pool/worker)
- [x] Implement retry decision evaluation in worker runtime (backward-compatible)
- [x] Add limiter coordinator in resilient worker and fairness tests
- [x] Publish migration notes + parity matrix update after implementation

## Phase 6: Scaling & Enterprise Features

**Goal**: Multi-region deployments, enterprise integrations, and advanced queue patterns for hyperscale.

### 6.1 Distributed Scheduling
- [ ] Region-aware job routing and affinity
- [ ] Distributed queuing with consensus (Redis Cluster, Postgres replication)
- [ ] Worker registration and heartbeat registry
- [ ] Multi-region scheduler failover

### 6.2 Advanced Queue Patterns
- [ ] Queue groups with weight-based distribution
- [ ] Conditional routing (job hints ↔ worker tags)
- [ ] Cost-aware scheduling (optimize for cost vs latency)
- [ ] Hierarchical rate governance (group-level budgets and burst allocation)

### 6.3 Multi-Region Replication
- [ ] Storage replication (primary/replica backends)
- [ ] Job state synchronization and eventual consistency
- [ ] Disaster recovery workflows and region failover
- [ ] Replication lag monitoring and alerting

### 6.4 Enterprise Integrations
- [ ] Datadog observability and custom metrics
- [ ] New Relic tracing and dashboards
- [ ] PagerDuty incident escalation
- [ ] Slack notifications and workflow buttons
- [ ] Audit logging and compliance trail

### 6.5 Documentation & Guides
- [ ] Distributed deployment guide
- [ ] Enterprise operations playbooks
- [ ] Advanced patterns cookbook

## Phase 7: Durable Event Queue

**Goal**: Evolve the in-memory lifecycle event bus into a durable, distributed event queue pipeline with at-least-once delivery, replay, and external publishing.

### 7.1 Contract + Plumbing
- [ ] `QueueLifecycleEnvelope` type definition
- [ ] `EventBridgePlugin` mapping hooks → envelopes → `system.events` queue
- [ ] `eventQueue` config option in `SupervisorOptions`
- [ ] Unit tests: envelope emission and allowlist filtering

### 7.2 Durable Persistence + Replay
- [ ] Event storage schema (`events`, `event_delivery` tables / collections)
- [ ] `EventPersistJob` worker
- [ ] Optional event log methods on `QueueStorage` interface
- [ ] `supervisor.queryEvents()` cursor-based replay API
- [ ] Persistence and replay tests

### 7.3 External Publishing + DLQ Hardening
- [ ] `EventSink` interface and `EventPublishJob` worker
- [ ] Event-specific retry policy and DLQ route (`system.events.dlq`)
- [ ] Event pipeline metrics (dispatch, lag, failure, DLQ depth)
- [ ] Retry/DLQ tests

### 7.4 Multi-Tenant Policy Controls (optional stretch)
- [ ] Tenant-scoped event filtering
- [ ] PII/data minimization redaction policies
- [ ] Retention and archival policies
- [ ] Policy enforcement tests

## Documentation Structure

```
/docs/operations/
├── ROADMAP.md                          (this file)
├── phase-1/
│   ├── phase-0-foundation.md          # Foundation implementation and architecture baseline
│   ├── delayed-jobs-design.md         # Delayed and scheduled jobs technical design
│   └── phase-1.1-implementation-summary.md
├── phase-2/
│   └── phase-2-observability-dashboard.md
├── phase-3/
│   └── phase-3-advanced-features.md
├── phase-4/
│   └── phase-4-ecosystem-integration.md
├── phase-5/
│   ├── phase-5-proposal.md            # Production readiness plan
│   ├── incident-playbooks.md          # Incident response runbooks
│   └── capacity-planning-toolkit.md   # Sizing formulas and examples
├── phase-6/
│   └── phase-6-proposal.md
├── phase-7/
│   └── phase-7-proposal.md           # Durable event queue implementation plan
├── event-queue-implementation-plan.md # Detailed blueprint for Phase 7
├── migration-guides/
│   └── from-bullmq.md                 # BullMQ compatibility and migration path
├── quickstarts/
│   ├── express-adapter.md             # Express enqueue pattern
│   ├── next-adapter.md                # Next.js route handler pattern
│   ├── fastify-adapter.md             # Fastify route pattern
│   ├── nest-adapter.md                # Nest service/controller pattern
│   ├── hono-adapter.md                # Hono edge-style pattern
│   ├── elysia-adapter.md              # Elysia/Bun pattern
│   └── dashboard-integration.md
└── feature-catalog.md                 # Canonical implementation inventory
```

## Current Status

- **Active Phase**: Phase 6 planning (Phase 5.5 parity closure implemented)
- **Phase 7**: Durable event queue — planned, blueprint complete (see `event-queue-implementation-plan.md`)
- **Last Updated**: April 3, 2026
- **Tracking**: GitHub Projects (Vasto Evolution)
