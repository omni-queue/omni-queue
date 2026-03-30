# Omni-Queue Evolution Roadmap

**Goal**: Position omni-queue as a **superior alternative to BullMQ** with **Laravel Horizon's operational excellence**.

## Overview Timeline

```
2026 Q2         Q3              Q4              2027 Q1+            Q2+
├─ Phase 1  ├─ Phase 2.1  ├─ Phase 3.1  ├─ Phase 4  ├─ Phase 5      ├─ Phase 6
│  Delays   │  Metrics    │  Job Flows  │  Adapters │  Reliability  │  Enterprise
│  Priority │  Dashboard  │  Pause/Drain│  Integr.  │  Security     │  Distributed
│  Progress │  Archive    │  Timeout    │  CLI Tools│  Operability  │  Multi-region
│  DLQ      └─────────────└────────────└────────────└───────────────└────────────
```

## Phase 1: Core Job Lifecycle (Q2 2026)

### Objective
Make omni-queue feature-complete vs BullMQ basics. Achieve 80% feature parity.

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
- **Estimated**: 3-4 weeks (assumes foundation ready)

### 1.2 Job Priorities & Priority Queues **[DONE]**
- [x] Add priority field to StoredJob type
- [x] Implement priority bucket dequeue strategy
- [x] Update PooledExecutor for priority ordering
- [x] Example: Email routing (critical, high, normal, low)
- **Estimated**: 1.5-2 weeks

### 1.3 Job Progress Tracking **[DONE]**
- [x] Add setProgress() API to JobManager
- [x] Extend QueueStorage with progress storage
- [x] Add onProgress plugin hook
- [x] Real-time progress updates via plugins
- **Estimated**: 1 week

### 1.4 Dead Letter Queue (DLQ) **[DONE]**
- [x] Add maxAttempts to QueueConfig
- [x] Implement DLQ routing in ResilientWorker
- [x] Add getDLQ() supervisor API
- [x] Plugin hook: onFailedPermanently
- [x] Example: Failed job inspection & retry
- **Estimated**: 2 weeks

## Phase 2: Observability & Dashboard (Q3 2026)

### 2.1 Metrics Collection & Export **[DONE]**
- [x] @omni-queue/metrics package
- [x] Prometheus client integration
- [x] StatsD & DataDog exporters
- [x] Auto-collected metrics (queue depth, duration, failures)
- **Estimated**: 2-3 weeks

### 2.2 Web Dashboard (MVP) **[DONE]**
- [x] React + Tailwind UI
- [x] Queue overview & health
- [x] Job list browser with filtering
- [x] Failed job triage & retry UI
- [x] Real-time updates (SSE/WebSocket)
- [x] Worker scaling controls
- **Estimated**: 4-5 weeks

### 2.3 Job Archive & Audit **[DONE]**
- [x] SQL-based job archive
- [x] Configurable retention policies
- [x] Query builder for historical analysis
- **Estimated**: 2 weeks

## Phase 3: Advanced Features (Q4 2026)

### 3.1 Job Flows (DAG-based Workflows) **[DONE]**
- [x] JobFlow builder API
- [x] Parent-child dependency tracking
- [x] Atomic failure handling
- **Estimated**: 3-4 weeks

### 3.2 Queue Pause/Resume with Drain **[DONE]**
- [x] Graceful shutdown logic
- [x] Drain: wait for in-flight jobs
- [x] API: supervisor.pauseQueue(), resumeQueue()
- **Estimated**: 1.5 weeks

### 3.3 Job Timeout & Cancellation **[DONE]**
- [x] Per-job execution timer
- [x] Signal handling for process workers
- [x] Configurable timeout behavior (kill, retry)
- **Estimated**: 2 weeks

## Phase 4: Ecosystem & Integration (2027 Q1+)

### 4.1 Official Adapters
- [x] @omni-queue/mysql-store
- [x] @omni-queue/postgres-store
- [x] @omni-queue/mongo-store
- [x] @omni-queue/dynamodb-store

### 4.2 Framework Integrations
- [x] @omni-queue/express-adapter (default via dashboard-api)
- [x] @omni-queue/next-adapter
- [x] @omni-queue/fastify-adapter
- [x] @omni-queue/nest-adapter
- [x] @omni-queue/hono-adapter

### 4.3 CLI Tooling
- [x] `omni-queue init`
- [x] `omni-queue generate:job`
- [x] `omni-queue monitor`
- [x] `omni-queue dlq:*` commands

### 4.4 BullMQ Parity Gap Sprint (Pre-Phase 5)
- [x] Durable repeatable jobs (persisted schedules + restart recovery)
- [x] Idempotency keys and deduplication strategy
- [x] Job administration operations (`promote`, `remove`, `clean`, `obliterate`)
- [x] Unified event stream contract for queue/worker/job lifecycle

## Phase 5: Production Readiness & Adoption (2027 Q2+)

### 5.1 Reliability Hardening
- [x] Exactly-once/idempotency guidance and helper APIs
- [x] Backpressure and circuit-breaker strategy at queue/worker level
- [x] Poison-message policy templates (quarantine, auto-snooze, escalation)

### 5.2 Security & Multi-Tenancy
- [x] Dashboard/API RBAC roles (viewer/operator/admin)
- [x] API tokens with scoped permissions and rotation guidance
- [x] Tenant isolation model for queues, DLQ, and metrics boundaries

### 5.3 Operability at Scale
- [x] SLO-focused dashboards (latency, success rate, recovery time)
- [x] Incident playbooks and runbooks for common failure modes
- [x] Capacity planning toolkit for worker and storage sizing

### 5.4 Developer Adoption & Migration
- [x] Migration toolkit and compatibility layer from BullMQ
- [x] Framework quickstarts for all official adapters
- [x] Opinionated templates for API jobs, workflow jobs, and scheduled jobs

### 5.5 BullMQ Parity Closure (Hard Gaps)
- [ ] Strict worker sandboxing policy (filesystem/env/network allowlists) for isolated execution
- [ ] Custom retry logic surface (error-aware retry strategy hooks)
- [x] Per-job backoff hooks (`Job.backoff(attempt)`) with runtime precedence
- [ ] Per-consumer rate limiting (in addition to current queue-level limits)

**Execution checklist (5.5)**
- [ ] Add config contracts for sandbox policy, retry policy, and per-consumer limits
- [ ] Wire process-isolation sandbox enforcement path (runtime → isolation → process pool/worker)
- [ ] Implement retry decision evaluation in worker runtime (backward-compatible)
- [ ] Add limiter coordinator in resilient worker and fairness tests
- [ ] Publish migration notes + parity matrix update after implementation

## Phase 6: Scaling & Enterprise Features (2027 Q3+)

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

## Success Metrics

| Metric | Current | Q2 Target | Q4 Target |
|--------|---------|-----------|-----------|
| Feature Completeness vs BullMQ | ~30% | ~50% | ~80% |
| GitHub Stars | - | 500+ | 1500+ |
| npm Downloads/week | - | 5k+ | 20k+ |
| Missing Core Features | 12+ | 6+ | 2+ |
| Has Web Dashboard | ❌ | ❌ | ✅ |
| Metrics Export | ❌ | ✅ | ✅ |

## Key Differentiators

| Feature | BullMQ | Omni-Queue |
|---------|--------|-----------|
| **Worker Isolation** | Sandboxed only | **Flexible: inline/thread/process** |
| **Storage** | Redis only | **Pluggable: Redis, SQL, In-memory** |
| **Auto-scaling Supervisor** | ❌ | **✅ Built-in** |
| **Dashboard** | Bull Board (3rd-party) | **First-party, Horizon-quality** |
| **Job Flows** | ❌ | **✅ DAG-based** |
| **Metrics** | Via plugins | **Built-in, multi-backend** |

## Documentation Structure

```
/docs/operations/
├── ROADMAP.md                          (this file)
├── phase-1/
│   ├── delayed-jobs-design.md         # Technical design
│   ├── priorities-design.md
│   ├── progress-design.md
│   └── dlq-design.md
├── phase-5/
│   └── phase-5-proposal.md            # Production readiness plan
│   ├── incident-playbooks.md          # Incident response runbooks
│   └── capacity-planning-toolkit.md   # Sizing formulas and examples
├── migration-guides/
│   └── from-bullmq.md                 # BullMQ compatibility and migration path
├── quickstarts/
│   ├── express-adapter.md             # Express enqueue pattern
│   ├── next-adapter.md                # Next.js route handler pattern
│   ├── fastify-adapter.md             # Fastify route pattern
│   ├── nest-adapter.md                # Nest service/controller pattern
│   └── hono-adapter.md                # Hono edge-style pattern
├── architecture/
│   ├── delayed-job-promoter.md        # System components
│   ├── job-lifecycle.md
│   └── storage-adapter-protocol.md
├── api-reference/
│   ├── job-manager-api.md             # API docs
│   ├── scheduler-api.md
│   └── dlq-api.md
├── examples/
│   ├── delayed-jobs.ts                # Code samples
│   ├── scheduling-jobs.ts
│   └── dlq-management.ts
└── migration-guides/
    └── from-bullmq.md                 # Migration docs
```

## Current Status

- **Active Phase**: Phase 5.5 planning (BullMQ parity closure)
- **Last Updated**: March 29, 2026
- **Tracking**: GitHub Projects (Omni-Queue Evolution)
