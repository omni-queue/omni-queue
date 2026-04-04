# Migrating from BullMQ to Vasto

This guide maps common BullMQ concepts onto Vasto primitives so teams can migrate incrementally without redesigning their job model from scratch.

**Before you start**: Review the [BullMQ compatibility assessment](bullmq-parity-assessment.md) to understand current feature coverage and migration notes for your use cases.

## Who this guide is for

This guide is intended for teams that:

- currently run BullMQ in production or staging
- want typed jobs and pluggable storage backends
- need a gradual, queue-by migration path
- want to preserve operational confidence during cutover

## Before you migrate

Capture a baseline from your BullMQ deployment before moving traffic:

- queue names and processor ownership
- retry and backoff settings
- delayed and repeatable job usage
- dead-letter or failure-handling conventions
- expected throughput, latency, and error rates

This baseline becomes the acceptance bar for your first migrated queue.

## Concept mapping

| BullMQ | Vasto |
| --- | --- |
| `Queue` | `JobManager` + queue name returned by `Job.queue()` |
| `Worker` | `Worker` / `ResilientWorker` managed by `Supervisor` |
| `QueueEvents` | lifecycle events and dashboard event streams |
| `FlowProducer` | `Supervisor.dispatchFlow()` |
| repeatable jobs | `jobManager.schedule()` |
| attempts / backoff | job options + retry/runtime policies |
| rate limiting / pausing | reliability backpressure + circuit breaker policies |
| failed set / DLQ handling | dead-letter queues + poison-message policies |

## Parity guide

| Concern | BullMQ pattern | Vasto pattern | Migration note |
| --- | --- | --- | --- |
| Enqueue work | `queue.add()` | `jobManager.dispatch()` | Replace job-name strings with typed job classes |
| Delayed jobs | `delay` option | `delayMs`, `delayUntil`, or `schedule({ runAt })` | Prefer explicit scheduling when timing is first-class |
| Repeatable jobs | repeat config | `jobManager.schedule({ intervalMs | pattern })` | Cron-like recurring work maps cleanly |
| Flows | `FlowProducer` | `supervisor.dispatchFlow()` | Dependencies are explicit through `dependsOn` |
| Retries | `attempts`, `backoff` | retry policies + queue reliability config | Re-check terminal failure semantics during cutover |
| Failure isolation | failed set inspection | DLQ + poison policy | Decide whether to quarantine, snooze, or dead-letter |
| Queue pausing | operational pause/resume | backpressure and circuit breaker controls | Vasto makes load shedding policy-driven |

## Migration path

### 1. Convert processors into typed jobs

In BullMQ, processors are often free functions attached to a queue. In Vasto, promote them into `Job` subclasses with a typed payload and explicit queue affinity.

```ts
import { Job } from '@vasto/core';

export class SendEmailJob extends Job<{ userId: string }> {
  static jobName = 'send-email';
  override jobName = SendEmailJob.jobName;

  override queue(): string {
    return 'emails';
  }

  override async handle(payload: { userId: string }) {
    return { delivered: true, userId: payload.userId };
  }
}
```

### 2. Replace `queue.add()` with `dispatch()`

BullMQ:

```ts
await queue.add('send-email', { userId: 'u_123' });
```

Vasto:

```ts
await jobManager.dispatch(new SendEmailJob({ userId: 'u_123' }));
```

If your BullMQ code relies on dynamic job names, keep the external name stable through `static jobName` while moving the implementation into a typed class.

### 3. Replace repeatable jobs with schedules

BullMQ:

```ts
await queue.add('daily-digest', {}, { repeat: { pattern: '0 * * * *' } });
```

Vasto:

```ts
await jobManager.schedule(new DailyDigestJob({ triggeredBy: 'scheduler' }), {
  pattern: '0 * * * *',
});
```

For one-off future work, prefer:

```ts
await jobManager.schedule(new DailyDigestJob({ triggeredBy: 'operator' }), {
  runAt: Date.now() + 60_000,
});
```

### 4. Replace flows with `dispatchFlow()`

BullMQ `FlowProducer` trees map directly to flow nodes with explicit dependencies.

```ts
await supervisor.dispatchFlow([
  { id: 'prepare', job: new PrepareAssetJob({ assetId }) },
  { id: 'encode', job: new EncodeAssetJob({ assetId }), dependsOn: ['prepare'] },
  { id: 'publish', job: new PublishAssetJob({ assetId }), dependsOn: ['encode'] },
]);
```

### 5. Move queue-level operational behavior into configuration

BullMQ setups often evolve retry, backoff, and pause behavior through distributed worker code and operational conventions. In Vasto, centralize that behavior in queue definitions where possible.

This makes it easier to reason about:

- concurrency
- scheduling semantics
- idempotency expectations
- backpressure thresholds
- circuit-breaker recovery behavior

## Reliability parity

### Retries and poison handling

BullMQ retry settings typically sit on `attempts` and `backoff`. In Vasto, keep retries close to the queue definition and pair them with poison handling:

- auto-quarantine terminal failures
- dead-letter on repeated exhaustion
- emit lifecycle events for operator visibility

### Rate limiting and pausing

BullMQ's queue pausing is usually an operational control. Vasto adds runtime-aware controls:

- backpressure thresholds based on queue depth
- circuit breakers driven by failure rate
- recovery events exposed in the dashboard

## Recommended migration sequence

1. Select one queue with low business risk.
2. Port the processor to a typed `Job` class.
3. Keep payload shape and external job naming stable.
4. Compare latency, success rate, and retry behavior in a non-production environment.
5. Add reliability controls only after baseline execution parity is proven.
6. Migrate scheduled jobs and flows after single-dispatch parity is stable.
7. Expand queue coverage gradually.

## Cutover checklist

- [ ] Payload schemas are documented and stable
- [ ] Queue names are unchanged or intentionally remapped
- [ ] Retry and timeout behavior has been reviewed
- [ ] Delayed and repeatable jobs have equivalent scheduling rules
- [ ] Failure handling and DLQ semantics are tested
- [ ] Operator dashboard access is configured
- [ ] Throughput and error-rate comparisons are captured before production cutover

## Non-goals

This guide does not attempt to promise byte-for-byte behavioral equivalence for every BullMQ extension or custom Redis-side convention. Instead, it provides a practical migration path for the core queueing concerns most teams rely on:

- enqueueing
- scheduling
- workflows
- retries
- failure handling
- operator observability

## Recommended rollout

1. Migrate one queue first.
2. Keep job names stable for auditability.
3. Enable reliability policies only after baseline parity is confirmed.
4. Use the dashboard to compare throughput, failures, and latency during cutover.
5. Move flows and schedules after single-job dispatch is stable.

## Starter commands

Use the CLI to generate migration-friendly templates:

- `vasto generate job --name=send-email`
- `vasto generate api-job --name=send-email`
- `vasto generate workflow --name=asset-pipeline`
- `vasto generate scheduled --name=daily-digest`
