# BullMQ Compatibility Assessment (as of 30 March 2026)

This document maps BullMQ's feature set to Vasto's current implementation (code + docs) to support practical migration planning.

## Compatibility Snapshot

Vasto currently covers the common BullMQ use cases in Redis-backed deployments, including sandboxed execution, retry ergonomics, and distributed rate limiting semantics in the evaluated scope.

---

## Feature Matrix

| Category | Feature | BullMQ | Vasto | Status | Notes |
|----------|---------|--------|-----------|--------|-------|
| **Core Queueing** |
| | Job enqueue/dequeue | ✅ | ✅ | 🟢 Full | Both have identical semantics |
| | Job data persistence | ✅ | ✅ | 🟢 Full | Vasto supports pluggable storage |
| | Job naming/registration | ✅ | ✅ | 🟢 Full | Vasto uses typed classes vs strings |
| | Worker concurrency | ✅ | ✅ | 🟢 Full | Configurable per-worker |
| | Auto-scaling | ❌ | ✅ | 🟢 Advantage | Vasto has built-in supervisor scaling |
| **Scheduling** |
| | Delayed jobs (runAt) | ✅ | ✅ | 🟢 Full | Identical UX |
| | Repeatable jobs (cron) | ✅ | ✅ | 🟢 Full | Both support cron patterns |
| | Repeatable jobs (interval) | ✅ | ✅ | 🟢 Full | Both support fixed intervals |
| | Job archival | ❌ | ✅ | 🟢 Advantage | Vasto stores completed job history |
| **Retries & Failure Handling** |
| | Max attempts | ✅ | ✅ | 🟢 Full | Both support configurable retries |
| | Exponential backoff | ✅ | ✅ | 🟢 Full | Queue-level or job-level |
| | Custom backoff strategies | ✅ | ✅ | 🟢 Full | Vasto supports `Job.backoff(attempt)`, `Job.retryPolicy()`, queue-level retry rules, and built-in named jitter strategies (`full-jitter`, `equal-jitter`, `decorrelated-jitter`) |
| | Dead-letter queue (DLQ) | ✅ | ✅ | 🟢 Full | Both move failed jobs after max attempts |
| | DLQ replay/retry | ✅ | ✅ | 🟢 Full | Both support rerunning DLQ jobs |
| | Poison message handling | ❌ | ✅ | 🟢 Advantage | Vasto has policies: quarantine, snooze, escalate |
| **Workflow & Dependencies** |
| | Job flows (DAG) | ❌ | ✅ | 🟢 Advantage | Vasto has `dispatchFlow()` with explicit dependencies |
| | Flow node dependencies | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Atomic flow failure | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Parent-child jobs | ✅ | ✅ | 🟢 Full | Both support implicitly via flows |
| **Priorities** |
| | Job priorities | ✅ | ✅ | 🟢 Full | Both support critical/high/normal/low |
| | Priority queue isolation | ❌ | ✅ | 🟢 Advantage | Vasto isolates priority buckets |
| **Progress Tracking** |
| | Job progress API | ✅ | ✅ | 🟢 Full | Both have `reportProgress(pct)` |
| | Progress history | ❌ | ✅ | 🟢 Advantage | Vasto persists progress samples |
| **Worker Isolation** |
| | Inline execution | ✅ | ✅ | 🟢 Full | Both support in-process jobs |
| | Worker threads | ⚠️ | ✅ | 🟢 Advantage | BullMQ via Node worker_threads; Vasto has first-class ThreadPool |
| | Child processes | ⚠️ | ✅ | 🟢 Advantage | BullMQ via fork; Vasto has first-class ProcessPool |
| | Sandboxing | ✅ | ✅ | 🟢 Full | Vasto enforces strict sandbox policies for thread/process isolation and rejects inline mode when sandboxing is enabled |
| **Storage Backends** |
| | Redis | ✅ | ✅ | 🟢 Full | Both fully supported |
| | PostgreSQL | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | MySQL | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | MongoDB | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | DynamoDB | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | In-memory | ⚠️ | ✅ | 🟢 Advantage | BullMQ dev-only; Vasto production-viable |
| **Observability** |
| | Events/hooks | ✅ | ✅ | 🟢 Full | Both have lifecycle hooks |
| | Metrics export | ⚠️ | ✅ | 🟢 Advantage | BullMQ via plugin; Vasto built-in |
| | Dashboard | ❌ | ✅ | 🟢 Advantage | BullMQ uses Bull Board (3rd-party); Vasto first-party |
| | Real-time monitoring | ⚠️ | ✅ | 🟢 Advantage | BullMQ requires extra setup; Vasto built-in SSE/WS |
| | Lifecycle event stream | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| **Idempotency** |
| | Deduplication keys | ✅ | ✅ | 🟢 Full | Both support idempotency keys |
| | Dedup helper API | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| **Reliability** |
| | Backpressure | ❌ | ✅ | 🟢 Advantage | Only in Vasto (queue-depth-aware) |
| | Circuit breaker | ❌ | ✅ | 🟢 Advantage | Only in Vasto (failure-rate-aware) |
| | Rate limiting | ⚠️ | ✅ | 🟢 Full | Vasto supports queue-level + per-consumer limits with distributed token consumption on Redis-backed storage |
| **Security & Multi-Tenancy** |
| | RBAC dashboard | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | API token scopes | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Tenant isolation | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Bearer token auth | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| **Admin Operations** |
| | Pause/resume queue | ✅ | ✅ | 🟢 Full | Both supported |
| | Drain queue | ✅ | ✅ | 🟢 Full | Both supported |
| | Clean queue | ✅ | ✅ | 🟢 Full | Both supported |
| | Obliterate queue | ✅ | ✅ | 🟢 Full | Both supported |
| | Get queue depth | ✅ | ✅ | 🟢 Full | Both supported |
| | Job inspection API | ✅ | ✅ | 🟢 Full | Both supported |
| | Promote/remove jobs | ✅ | ✅ | 🟢 Full | Both supported |
| **Batch Operations** |
| | Batch job composition | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Batch progress tracking | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| **Framework Integration** |
| | Express adapter | ⚠️ | ✅ | 🟢 Advantage | BullMQ needs manual setup; Vasto has official adapter + quickstart |
| | Next.js adapter | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Fastify adapter | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Nest adapter | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Hono adapter | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| **CLI & Scaffolding** |
| | Project init | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Job scaffolding | ⚠️ | ✅ | 🟢 Advantage | BullMQ none; Vasto has `vasto generate job` + variants |
| | Monitoring CLI | ⚠️ | ✅ | 🟢 Advantage | BullMQ via external tools; Vasto has `queue monitor` |
| **Documentation & Migration** |
| | Migration guide | ❌ | ✅ | 🟢 Advantage | Only in Vasto |
| | Framework quickstarts | ❌ | ✅ | 🟢 Advantage | Only in Vasto |

---

## Summary by Category

### 🟢 **Full Parity** (Interchangeable)
- Core queueing (enqueue/dequeue/naming)
- Job delays and scheduling (runAt, cron, intervals)
- Retries and backoff
- Dead-letter queues
- Priorities
- Progress tracking
- Worker concurrency
- Job inspection and admin ops
- Deduplication/idempotency

**Count**: ~28 features

### 🟡 **Partial Parity** (Usable but different)
- None in the evaluated BullMQ parity set.

**Count**: ~0 features

### 🟢 **Vasto Extensions** (Beyond BullMQ)
- Auto-scaling supervisor
- Job archival (completed job history)
- Poison message policies (quarantine, snooze, escalate)
- Job flows with DAG dependencies
- Progress history
- Pluggable storage (Postgres, MySQL, MongoDB, DynamoDB)
- Built-in first-party dashboard
- Real-time observability (lifecycle event bus)
- Backpressure and circuit breaker
- RBAC and multi-tenancy
- Batch job composition
- Official framework adapters (Express, Next, Fastify, Nest, Hono)
- CLI scaffolding and project initialization
- Migration guide and quickstarts

**Count**: ~22 features

### ❌ **Missing from Vasto** (BullMQ has)
- No major day-1 parity blocker in the evaluated set.

**Count**: ~0 hard gaps

---

## Feature Assessment by Use Case

### **Scenario 1: Simple Email Queue** (e.g., send 10k emails/day)
- **BullMQ**: ✅ Sufficient (enqueue, retry, DLQ)
- **Vasto**: ✅ Sufficient (same + progress tracking, better monitoring)
- **Verdict**: Both fine; Vasto has better observability

### **Scenario 2: Video Processing Pipeline** (multi-region, dependent steps)
- **BullMQ**: ⚠️ Possible (requires manual parent-child logic)
- **Vasto**: ✅ Ideal (native flows, conditional routing possible in Phase 6)
- **Verdict**: Vasto reduces custom orchestration work

### **Scenario 3: Enterprise Multi-Tenant SaaS** (isolation, audit, RBAC)
- **BullMQ**: ⚠️ Requires custom implementation
- **Vasto**: ✅ Built-in (RBAC, tenant filtering, audit logging)
- **Verdict**: Vasto provides these controls out of the box

### **Scenario 4: Scheduled Maintenance Tasks** (cron jobs, reports)
- **BullMQ**: ✅ Sufficient (repeatable jobs)
- **Vasto**: ✅ Sufficient (same + archival for audit)
- **Verdict**: Equivalent; Vasto has edge in compliance

### **Scenario 5: Microservices with Rate Limits** (controlled throughput)
- **BullMQ**: ✅ Sufficient (queue-level rate limiting)
- **Vasto**: ✅ Sufficient (queue-level + per-consumer limits with Redis-distributed coordination)
- **Verdict**: Equivalent

---

## Migration Complexity

### **Easy Migration** (< 1 day)
- Jobs with only enqueue/retry/delay
- Single setups
- Basic priority use cases
- Existing job names can stay stable

### **Moderate Migration** (1–3 days)
- Multi systems with cross coordination
- Dashboard integration (learn Vasto dashboard)

### **Complex Migration** (1–2 weeks)
- Sandboxed job model (thread/process pool retuning needed)
- Heavy custom BullMQ plugin usage
- Distributed Redis Cluster setups (Phase 6 in progress)

---

## Recommendations

### **When BullMQ is a Good Fit**
1. **Pure Redis-only setup** — Redis Cluster management well-tested
2. **Established ecosystem** — BullMQ has more 3rd-party plugins

### **When Vasto is a Good Fit**
1. **Multi-storage flexibility** — SQL, document, or NoSQL backends
2. **Job workflows/DAGs** — Native `dispatchFlow()` support
3. **Enterprise multi-tenancy** — Built-in RBAC, tenant isolation, audit
4. **Operational observability** — First-party dashboard and lifecycle events
5. **Auto-scaling** — Built-in supervisor with elastic worker management
6. **Open-source adoption** — Well-documented, low barrier to entry
7. **Cost optimization** — Choose storage that fits your infrastructure (Postgres vs Redis vs DynamoDB)

---

## Known Limitations & Not-Implemented

### **Phase 5 (Current + 5.5 Parity Closure)**
- Consumer groups (Kafka-style, targeted for Phase 7)
- Distributed tracing integration (OpenTelemetry added, but not first-class)

### **Future Phases (Phase 6+)**
- Multi-region active-active failover (Phase 6.3)
- Enterprise integrations (Datadog, PagerDuty, Slack) (Phase 6.4)
- Custom worker sandboxing model (future, if user demand)

---

## Conclusion

**Vasto achieves ~100% parity with BullMQ** on feature breadth in the evaluated feature set, with the following profile:

- **Equivalent**: Core queueing, scheduling, retries, priorities, worker concurrency
- **Better**: Storage flexibility, observability, workflows, enterprise features, documentation
- **Worse**: No major gap in the evaluated parity scope; differences are mostly ecosystem maturity and operational preference
- **Unique**: Auto-scaling, flows, multi-tenancy, built-in dashboard, batch operations

**Recommended for**: Teams doing microservices/workflows, multi-storage/multi-tenant SaaS, teams wanting better observability, companies adopting open-source with OSS-friendly governance.

**Not recommended for**: teams that prioritize BullMQ-specific ecosystem integrations over Vasto's built-in first-party platform features.

---

## Migration Pathway

1. **Audit** — List your BullMQ queues and processor complexity
2. **Test** — Migrate 1–2 low-risk queues to Vasto in staging
3. **Build confidence** — Compare latency, throughput, error rates
4. **Adopt** — Roll out gradually, keeping BullMQ for complex retry scenarios if needed
5. **Consolidate** — Move to Phase 6 features (multi-region, advanced patterns) as they land
