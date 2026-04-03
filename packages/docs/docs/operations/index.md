---
title: Operations
description: Production readiness, capacity planning, and operational guidance for Vasto.
outline: deep
---

# Operations

This section covers what you need to know before taking Vasto to production.

## Production checklist

::: details Storage and persistence
- [ ] Switch from `InMemoryQueueStorage` to a persistent adapter (Redis, Postgres, or similar)
- [ ] Configure `maxAttempts` on queues where unchecked growth would be harmful
- [ ] Verify dead-letter queue retention and alerting
- [ ] Confirm `migrate()` is called at startup for SQL-backed adapters
:::

::: details Worker reliability
- [ ] Set meaningful `executionTimeoutMs` on long-running queues
- [ ] Choose a `timeoutStrategy` (`'retry'` vs `'fail'`) per queue
- [ ] Configure backpressure thresholds to prevent memory pressure
- [ ] Enable circuit breaker on queues that call external services
:::

::: details Dashboard and observability
- [ ] Dashboard is served behind authentication
- [ ] Failed-job retry actions are gated to authorised users
- [ ] A metrics plugin ships job events to your observability stack
- [ ] Alerting is in place for dead-letter queue growth
:::

::: details Deployment
- [ ] Workers restart cleanly on process exit (use a process manager or container restart policy)
- [ ] Environment variables for storage credentials are injected at runtime, not baked into the image
- [ ] Graceful shutdown is tested — `supervisor.stop()` drains in-flight jobs before exit
:::

## Reliability features

### Backpressure

When a queue's ready-job depth exceeds a threshold, Vasto can pause polling or add delay.

```ts
const queues = defineQueues({
  emails: {
    name: 'emails',
    connection: 'redis',
    concurrency: 10,
    batchSize: 20,
    reliability: {
      backpressure: {
        depthThreshold: 1000,
        resumeThreshold: 500,
        mode: 'pause',
      },
    },
  },
});
```

### Circuit breaker

Trips after a configured number of failures and enters a cooldown before retrying.

```ts
reliability: {
  circuitBreaker: {
    failureThreshold: 5,
    cooldownMs: 30_000,
    halfOpenMaxInFlight: 1,
    tripOnTimeout: true,
  },
}
```

### Poison message policy

Jobs that fail repeatedly can be quarantined, snoozed, or tagged for escalation before reaching the dead-letter queue.

```ts
reliability: {
  poisonPolicy: {
    template: 'quarantine',
    maxFailures: 3,
  },
}
```

## In-depth repository docs

The `docs/operations/` directory in the repository contains detailed internal documentation:

- [Feature catalog](https://github.com/vastohq/vasto/blob/develop/docs/operations/feature-catalog.md)
- [Roadmap](https://github.com/vastohq/vasto/blob/develop/docs/operations/ROADMAP.md)
- [Releasing guide](https://github.com/vastohq/vasto/blob/develop/docs/operations/releasing.md)
- [Phase 5 proposal](https://github.com/vastohq/vasto/blob/develop/docs/operations/phase-5/phase-5-proposal.md)
