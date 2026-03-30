# Phase 5 Proposal: Production Readiness & Adoption

## Objective
Position Omni-Queue for reliable production rollout in multi-team environments by strengthening reliability controls, security boundaries, and operational tooling.

## Scope
Phase 5 focuses on four tracks:
1. Reliability hardening
2. Security and multi-tenancy
3. Operability at scale
4. Developer adoption and migration

## Milestones

### Milestone 5.1 — Reliability Hardening (2-3 weeks)
**Deliverables**
- Idempotency strategy and helper APIs for common job patterns.
- Queue-level backpressure controls and worker-side circuit-breaker behavior.
- Poison-message policies (quarantine / auto-snooze / escalation).

**Acceptance Criteria**
- Duplicate-submit scenarios are documented with at least one code-level mitigation path.
- Backpressure thresholds are configurable and observable in dashboard/API metrics.
- Poison-message handling can be enabled per queue with deterministic behavior.

#### Implementation Status (Completed)

Milestone 5.1 is implemented in `@omni-queue/core` and surfaced in the dashboard stack.

**1) Exactly-once / Idempotency guidance + helper APIs**
- Queue configuration supports idempotency via `queueConfig.idempotency`.
- Presets and builders are available in `packages/core/src/libs/reliability.ts`:
  - `createIdempotencyPolicy('strict' | 'balanced' | 'throughput')`
  - `createReliabilityProfile(...)`
- Runtime dedupe resolution is enforced in `JobManager.dispatchInternal(...)` via `findDuplicateByIdempotencyKey(...)`.

**2) Backpressure + circuit breaker strategy**
- Queue configuration supports runtime reliability controls via `queueConfig.reliability`:
  - `backpressure` (`depthThreshold`, `resumeThreshold`, `checkIntervalMs`, `mode`)
  - `circuitBreaker` (`failureThreshold`, `cooldownMs`, `halfOpenMaxInFlight`, `tripOnTimeout`)
- Worker-side enforcement is implemented in `ResilientWorker`:
  - backpressure gate: `checkBackpressure(...)`
  - circuit breaker state machine: `canExecuteByCircuitBreaker(...)`, `onExecutionSucceeded(...)`, `onExecutionFailed(...)`
- Reliability transitions emit lifecycle events (`queue.backpressure`, `queue.backpressure.cleared`, `queue.circuit.changed`).

**3) Poison-message policy templates**
- Queue configuration supports `poisonPolicy` templates:
  - `quarantine`
  - `auto-snooze`
  - `escalation`
- Runtime handling is implemented in `JobManager.applyPoisonFailurePolicy(...)`:
  - `quarantine` and `escalation` route to DLQ with deterministic tagging.
  - `auto-snooze` re-enqueues delayed jobs with poison metadata.

**4) Dashboard/API observability coverage**
- Overview payload includes reliability snapshot (`openCircuits`, `halfOpenCircuits`, `backpressuredQueues`, per-queue states).
- Metrics and queue pages render current reliability status for operators.

**Usage Example**

```ts
import {
  createReliabilityProfile,
  createPoisonMessagePolicy,
  defineQueues,
} from '@omni-queue/core';

const profile = createReliabilityProfile({
  exactlyOnce: 'balanced',
  backpressure: { depthThreshold: 1200, resumeThreshold: 600, mode: 'delay' },
  circuitBreaker: { failureThreshold: 5, cooldownMs: 30000 },
  poisonPolicy: { template: 'escalation', overrides: { escalationTag: 'ops:p1' } },
});

export const queues = defineQueues({
  default: {
    name: 'default',
    connection: 'memory',
    concurrency: 4,
    batchSize: 50,
    idempotency: profile.idempotency,
    reliability: profile.reliability,
  },
});

// Or apply a direct policy template:
const quarantinePolicy = createPoisonMessagePolicy('quarantine');
```

### Milestone 5.2 — Security & Multi-Tenancy (2-3 weeks)
**Deliverables**
- Dashboard/API role model: `viewer`, `operator`, `admin`.
- Token-based auth with scoped permissions and rotation guidance.
- Tenant boundary strategy for queues, DLQ, jobs list, and metrics access.

**Acceptance Criteria**
- Unauthorized calls are consistently denied across dashboard endpoints.
- Role permissions are validated by integration tests.
- Tenant-aware filtering is enforced server-side (not UI-only).

#### Implementation Status (Completed)

Milestone 5.2 is implemented in dashboard auth contracts, request middleware, route guards, and websocket streaming.

**1) RBAC roles (`viewer` / `operator` / `admin`)**
- Auth contracts now support role/context-based decisions:
  - `DashboardRole`
  - `DashboardAuthContext`
  - `DashboardAuthDecision`
- Middleware resolves role context per request and enforces route permissions:
  - `read`: read-only endpoints
  - `operate`: queue/job operational actions (pause/resume/drain/retry/promote/remove/clean)
  - `admin`: high-risk administrative controls (retention/scaling writes)

**2) Scoped API tokens + rotation guidance**
- Tokens are modeled by `DashboardApiToken` with:
  - `id`, `token`, `role`
  - optional `scopes`, `tenantId`, `allowedQueues`, `expiresAt`, `active`
- Reusable helper APIs in `@omni-queue/dashboard-api`:
  - `createScopedBearerAuth({ tokens, realm })`
  - `rotateScopedBearerTokens(currentTokens, updates)`
- Rotation pattern:
  1. Add a new token (`op: 'add'`) and deploy.
  2. Cut clients over to the new token.
  3. Disable old token (`op: 'disable'`) without immediate deletion.
  4. Optionally replace metadata (`op: 'replace'`) for controlled rollovers.

**3) Tenant isolation model (server-side)**
- Tenant boundaries are enforced with `allowedQueues` from auth context.
- Queue-scoped filtering is applied server-side to:
  - overview/summary and SSE overview stream
  - queue listing and queue status endpoints
  - jobs/failed/ready/active/completed/silenced endpoints
  - job lookup and queue/job mutation endpoints
  - lifecycle event history and lifecycle SSE stream
  - websocket overview and lifecycle event push
- Filtering is applied before response emission so unauthorized queue data is not exposed.

**Usage Example: scoped bearer auth**

```ts
import { createScopedBearerAuth, rotateScopedBearerTokens } from '@omni-queue/dashboard-api';

let tokens = [
  {
    id: 'viewer-tenant-a-v1',
    token: process.env.DASHBOARD_TOKEN_VIEWER_A!,
    role: 'viewer',
    scopes: ['dashboard:read'],
    tenantId: 'tenant-a',
    allowedQueues: ['tenant-a:emails', 'tenant-a:billing'],
    active: true,
  },
  {
    id: 'ops-global-v1',
    token: process.env.DASHBOARD_TOKEN_OPS!,
    role: 'operator',
    scopes: ['dashboard:read', 'dashboard:operate'],
    active: true,
  },
];

const auth = createScopedBearerAuth({ tokens, realm: 'omni-queue-dashboard' });

// Rotation (blue/green token rollout)
tokens = rotateScopedBearerTokens(tokens, [
  {
    op: 'add',
    token: {
      id: 'ops-global-v2',
      token: process.env.DASHBOARD_TOKEN_OPS_V2!,
      role: 'operator',
      scopes: ['dashboard:read', 'dashboard:operate'],
      active: true,
    },
  },
  { op: 'disable', tokenId: 'ops-global-v1' },
]);
```

### Milestone 5.3 — Operability at Scale (2 weeks)
**Deliverables**
- SLO dashboards and API endpoints centered on latency, success rate, and recovery time.
- Incident runbooks for queue saturation, worker crashes, storage unavailability, and DLQ growth.
- Capacity planning guide for worker concurrency and storage sizing.

**Acceptance Criteria**
- SLO metrics are visible in dashboard and exportable through existing metrics adapters.
- At least 4 documented incident playbooks with clear remediation steps.
- Capacity guidance includes baseline formulas and real workload examples.

#### Implementation Status (Completed)

**1) SLO-focused API + dashboard visibility**
- Added `GET /dashboard/slo` endpoint returning:
  - `p95LatencyMs`
  - `successRatePct`
  - `meanRecoveryMs`
  - completed/failed/recovered counts (overall + per queue)
- SLO metrics are now rendered in the Monitoring page:
  - KPI cards for latency, success rate, mean recovery, recovered incidents
  - per-queue SLO table for queue-level diagnosis
- Tenant queue restrictions are honored for SLO and monitoring results.

**2) Incident playbooks**
- Added runbooks with immediate actions, stabilization targets, and follow-up tasks for:
  - queue saturation
  - worker crash loops
  - storage unavailability/high latency
  - DLQ growth/poison messages
- Document location:
  - `docs/operations/phase-5/incident-playbooks.md`

**3) Capacity planning toolkit**
- Added sizing formulas and examples for:
  - baseline and conservative concurrency estimates
  - backlog drain-time estimation
  - headroom targets and tuning loop
  - storage pressure heuristics and threshold triggers
- Document location:
  - `docs/operations/phase-5/capacity-planning-toolkit.md`

### Milestone 5.4 — Developer Adoption & Migration (2 weeks)
**Deliverables**
- BullMQ migration toolkit and compatibility guidance.
- Adapter quickstarts for `express-adapter`, `next-adapter`, `fastify-adapter`, `nest-adapter`, `hono-adapter`.
- CLI templates for API jobs, workflow jobs, and scheduled jobs.

**Acceptance Criteria**
- Migration path covers job schema, retries, delayed jobs, and DLQ behavior mapping.
- Quickstarts are runnable in under 10 minutes each.
- CLI templates generate build-valid starter code.

**Implementation Status**

**1) BullMQ migration toolkit**
- Added a focused migration guide with concept mapping for:
  - queues and workers
  - flows
  - scheduled jobs
  - retries, DLQ, and reliability controls
- Document location:
  - `docs/operations/migration-guides/from-bullmq.md`

**2) Official adapter quickstarts**
- Added quickstarts for:
  - `express-adapter`
  - `next-adapter`
  - `fastify-adapter`
  - `nest-adapter`
  - `hono-adapter`
- Document locations:
  - `docs/operations/quickstarts/express-adapter.md`
  - `docs/operations/quickstarts/next-adapter.md`
  - `docs/operations/quickstarts/fastify-adapter.md`
  - `docs/operations/quickstarts/nest-adapter.md`
  - `docs/operations/quickstarts/hono-adapter.md`

**3) CLI starter templates**
- Extended the queue CLI with starter generators for:
  - `queue generate:api-job`
  - `queue generate:workflow`
  - `queue generate:scheduled`
- Added test coverage for each generator in `packages/cli/src/queue.test.ts`.

### Milestone 5.5 — BullMQ Parity Closure (2-4 weeks)
**Deliverables**
- Strict sandboxing controls for isolated workers (filesystem/env/network allowlists + policy enforcement).
- Error-aware custom retry logic (policy hooks by error class/code).
- Per-consumer rate limiting built on top of existing queue-level rate limits.
- Canonical docs clarifying that per-job backoff is already supported via `Job.backoff(attempt)`.

**Acceptance Criteria**
- Process-isolated workers can run under an explicit sandbox policy and reject disallowed access.
- Retry behavior can branch by failure type (for example timeout vs network vs validation).
- Rate limits can be configured and enforced per consumer identity without cross-tenant bleed.
- Migration docs and parity docs no longer list per-job backoff as a missing capability.

**Implementation Notes**
- Current baseline already provides per-job backoff hooks and queue-level rate limits.
- Milestone 5.5 closes only the hard parity gaps that remain from the BullMQ comparison.

#### Engineering Breakdown (Implementation-Ready)

**Track A — Strict Sandboxing for Isolated Workers**
- **Interfaces/contracts**
  - Extend `QueueConfig` with `sandbox?: { enabled: boolean; envAllowlist?: string[]; cwdAllowlist?: string[]; networkAllowlist?: string[]; denyChildProcessSpawn?: boolean; readOnlyFilesystem?: boolean }`.
  - Add optional per-worker override in `WorkerConfig` for environments where one worker serves multiple queue classes.
- **Runtime wiring**
  - Update `packages/core/src/libs/worker-runtime.ts` to pass sandbox policy into `runWithIsolation(...)` when `isolation === 'process'`.
  - Update `packages/core/src/libs/isolation.ts` to include sandbox policy in process execution payload/options.
  - Update `packages/core/src/libs/process-pool.ts` to enforce launch-time policy (`env` filtering, cwd checks, spawn guards).
  - Update `packages/core/src/libs/process-worker.ts` bootstrap to enforce runtime guards (network allowlist, child-process denial).
- **Behavioral target**
  - Sandbox policy is explicit and opt-in per queue.
  - Violations fail fast with deterministic error class (for retry policy consumption).

**Track B — Error-Aware Custom Retry Logic**
- **Interfaces/contracts**
  - Extend job contract with optional retry decision hook (for example `retryPolicy(error, context)`), while preserving `retries()` and `backoff(attempt)` compatibility.
  - Add queue-level fallback policy in `QueueConfig.retry` for teams that prefer config over job class methods.
- **Runtime wiring**
  - Update retry loop in `packages/core/src/libs/worker-runtime.ts` to evaluate policy before incrementing terminal failure state.
  - Introduce decision outcomes: `retry`, `fail`, `deadletter`, optionally with override backoff.
  - Preserve existing precedence: timeout strategy + poison policy + retry policy should be deterministic and documented.
- **Behavioral target**
  - Different error classes can map to different retry ceilings/backoff.
  - Existing jobs without new hook remain behaviorally unchanged.

**Track C — Per-Consumer Rate Limiting**
- **Interfaces/contracts**
  - Add consumer identity to `WorkerConfig` (for example `consumerId?: string`) with safe default to worker name.
  - Extend `QueueConfig.rateLimit` with optional `perConsumer?: { capacity: number; refillRate: number }`.
- **Runtime wiring**
  - Add rate-limit coordinator in `packages/core/src/libs/resilient-worker.ts` before dequeue.
  - Introduce helper module `packages/core/src/libs/rate-limiter.ts` for token-bucket/sliding-window calculations.
  - Phase 5.5 baseline: in-process coordinator; optional adapter-backed distributed counters as follow-up hardening.
- **Behavioral target**
  - One noisy consumer cannot starve others on the same queue.
  - Limits are tenant-safe when combined with Phase 5.2 queue access boundaries.

#### Test Matrix (5.5)

- `packages/core/tests/sandboxing.test.ts`
  - allows permitted env/cwd/network operations
  - rejects disallowed operations with deterministic error payloads
- `packages/core/tests/retry-policy.test.ts`
  - timeout/network/validation errors produce different retry decisions
  - legacy `retries()` + `backoff()` jobs remain backward-compatible
- `packages/core/tests/per-consumer-rate-limit.test.ts`
  - enforces per-consumer budgets under concurrent workers
  - verifies fairness and no cross-consumer starvation
- Extend `packages/core/tests/storage-compatibility.test.ts`
  - verify no regression in dequeue/lease behavior with limiter hooks enabled

#### Rollout Plan

1. **Feature flags (default off)** for sandboxing and per-consumer limiter.
2. **Canary queues** in examples before broad rollout.
3. **Metrics first**: emit policy decisions and throttle events before enforcing hard denies.
4. **Enforcement on** after two stable iterations with no false positives.

## Recommended Execution Order
1. Milestone 5.2 (security boundaries first)
2. Milestone 5.1 (reliability controls)
3. Milestone 5.3 (operability)
4. Milestone 5.4 (adoption and migration)
5. Milestone 5.5 (hard parity gap closure)

## Risks and Mitigations
- **Risk:** Feature expansion causes API fragmentation.  
  **Mitigation:** Keep new controls under existing dashboard-api route groups and shared typings.
- **Risk:** Tenant-aware filtering introduces performance overhead.  
  **Mitigation:** Push filtering into storage-layer query paths where possible.
- **Risk:** Migration promises outpace parity reality.  
  **Mitigation:** Publish a parity matrix and explicit non-goals before toolkit release.

## Exit Criteria for Phase 5
- Production readiness checklist is green for reliability, security, and observability.
- All new controls have dashboard visibility and API parity.
- Migration and quickstart documentation is complete and validated against examples.
