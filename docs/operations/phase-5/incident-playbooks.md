# Incident Playbooks (Phase 5.3)

This runbook covers the primary queue-operability incidents for Omni-Queue deployments.

## 1) Queue Saturation (Depth Growth)

### Signals
- Queue depth rising for 5+ minutes.
- Backpressure state active (`queue.backpressure` events).
- Wait time trend increasing.

### Immediate Actions
1. Confirm affected queues from dashboard reliability filters.
2. Increase worker scaling for impacted worker groups.
3. Pause non-critical producers if available.
4. Verify storage health and dequeue latency.

### Stabilization Targets
- Stop positive depth slope.
- Backpressure clears (`queue.backpressure.cleared`).
- Wait time returns below SLO threshold.

### Follow-up
- Tune queue `reliability.backpressure` thresholds.
- Increase baseline concurrency or isolate heavy queues.
- Add producer-side rate limiting if bursts are frequent.

---

## 2) Worker Crash Loop

### Signals
- Repeated `worker.stopped`/`worker.started` churn.
- Spike in `job.failed` and DLQ growth.
- Throughput collapse while queue depth rises.

### Immediate Actions
1. Identify worker name and queue set impacted.
2. Reduce concurrency for unstable worker temporarily.
3. Route critical queues to healthy worker pools.
4. Inspect error signatures and isolation mode mismatches.

### Stabilization Targets
- Worker restart frequency normalizes.
- Failure rate trend drops.
- Success rate recovers to target band.

### Follow-up
- Fix deterministic crash causes in job handlers.
- Revisit isolation strategy (`inline`/`thread`/`process`).
- Add canary worker rollout for risky updates.

---

## 3) Storage Unavailability / High Latency

### Signals
- API timeouts from queue operations.
- Dequeue/ack delay spikes across all queues on shared storage.
- Broad drop in completion throughput.

### Immediate Actions
1. Validate storage dependency status (Redis/SQL/etc.).
2. Temporarily reduce producer inflow.
3. Preserve in-flight integrity; avoid unsafe bulk retries.
4. Enable traffic shedding on non-critical queues.

### Stabilization Targets
- Storage latency returns within operational baseline.
- Queue mutation errors drop to normal.
- Throughput resumes without DLQ surge.

### Follow-up
- Add redundancy/failover strategy for storage tier.
- Tune connection pools/timeouts/retry behavior.
- Separate critical queues onto independent storage where practical.

---

## 4) DLQ Growth / Poison Messages

### Signals
- Sustained DLQ increase over baseline.
- Repeated failures for same tags/job types.
- Escalation-tagged poison items increasing.

### Immediate Actions
1. Segment DLQ by queue, job name, and tags.
2. Apply policy-driven handling:
   - quarantine: isolate and inspect
   - auto-snooze: delay and retry later
   - escalation: route for urgent investigation
3. Retry only validated, non-poison subsets.
4. Keep failing payload classes quarantined.

### Stabilization Targets
- DLQ growth trend flattens.
- Mean recovery time decreases.
- Incident recurrence reduced for same signatures.

### Follow-up
- Harden handler validation and idempotency boundaries.
- Add payload schema checks and guardrails.
- Improve alerting for early poison-message detection.

---

## Standard Incident Checklist

- Record impacted queues and tenant scope.
- Capture start/end timestamps for MTTR tracking.
- Save top error signatures and sample job IDs.
- Document remediation actions and rollback points.
- Update SLO dashboard notes with incident summary.
