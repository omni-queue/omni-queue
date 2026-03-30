# Capacity Planning Toolkit (Phase 5.3)

This guide provides baseline formulas and practical examples for sizing workers and storage.

## Core Inputs

- Arrival rate: jobs per second (`λ`)
- Service time: average runtime in seconds (`S_avg`)
- P95 runtime in seconds (`S_p95`)
- Target utilization per worker process (`U_target`, usually 0.65–0.80)
- Retry/DLQ amplification factor (`A`, >= 1.0)

## 1) Baseline Concurrency Estimate

Use:

$$
C_{base} = \left\lceil \frac{\lambda \cdot S_{avg} \cdot A}{U_{target}} \right\rceil
$$

Conservative (latency-sensitive) sizing:

$$
C_{safe} = \left\lceil \frac{\lambda \cdot S_{p95} \cdot A}{U_{target}} \right\rceil
$$

Recommended starting point:

$$
C_{start} = \max(C_{base},\; 0.7 \cdot C_{safe})
$$

## 2) Queue Backlog Drain Time

Given queue depth `D` and effective throughput `μ` (jobs/sec):

$$
T_{drain} = \frac{D}{\mu}
$$

With per-process service rate approximated by $1 / S_{avg}$:

$$
\mu \approx C \cdot \frac{1}{S_{avg}}
$$

## 3) Headroom Targets

- Keep normal utilization below 80%.
- Keep 20–30% concurrency headroom for bursts.
- Track backpressure activation frequency; frequent activation indicates under-provisioning.

## 4) Storage Sizing Heuristics

### Read/Write Pressure
- Each job typically implies enqueue + dequeue + lease updates + ack + completion archive writes.
- Retry-heavy workloads significantly increase write amplification.

### Retention Controls
- Completed job retention impacts storage growth linearly with throughput.
- Apply archive retention windows and max rows per queue to cap growth.

### Throughput Isolation
- Separate high-churn queues from latency-sensitive queues when shared storage saturation is observed.

## 5) Worked Example

Assume:
- $\lambda = 120$ jobs/sec
- $S_{avg} = 0.25$ sec
- $S_{p95} = 0.80$ sec
- $A = 1.10$
- $U_{target} = 0.75$

$$
C_{base} = \left\lceil \frac{120 \cdot 0.25 \cdot 1.10}{0.75} \right\rceil = \lceil 44 \rceil = 44
$$

$$
C_{safe} = \left\lceil \frac{120 \cdot 0.80 \cdot 1.10}{0.75} \right\rceil = \lceil 141 \rceil = 141
$$

Start with 100 total process slots, then tune from observed p95 latency and success rate trends.

## 6) Tuning Loop

1. Measure SLOs (`p95 latency`, `success rate`, `mean recovery`).
2. Compare queue depth slope and backpressure frequency.
3. Adjust concurrency/scaling by 10–20% steps.
4. Re-check storage saturation and retry amplification.
5. Repeat weekly or after significant traffic/profile changes.

## 7) Trigger Thresholds (Suggested)

- Depth growth > 10% for 5 minutes: scale up or throttle producers.
- Success rate < 99% sustained 10 minutes: investigate failure classes.
- Mean recovery time > target SLA: prioritize incident response and runbook execution.
