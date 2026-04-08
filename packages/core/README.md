# @vasto-queue/core

Core runtime package for Vasto.

## What this package provides

- `Supervisor` orchestration for workers, lifecycle, scaling, and queue ownership.
- `JobManager` runtime for dispatch, scheduling, execution, retries, DLQ handling, flows, and batches.
- `JobRegistry` and class-based typed jobs.
- `QueueStorage` contract and `InMemoryQueueStorage` implementation.
- Isolation runtime (`inline`, `thread`, `process`) and isolation helper wiring.
- Reliability and security controls exposed through queue and worker config.

## Core feature surface

### Dispatch and scheduling
- Immediate dispatch.
- Delayed dispatch (`delayMs`, `delayUntil`).
- Scheduled dispatch (`runAt`, `intervalMs`, cron `pattern` + `timezone`).

### Execution and isolation
- Worker isolation modes: `inline`, `thread`, `process`.
- Execution timeout controls: `executionTimeoutMs`, `timeoutStrategy`, `timeoutSignal`.
- Sandbox policy enforcement for isolated execution (`thread` and `process`); inline execution is rejected when sandboxing is enabled.

### Retry and failure handling
- Attempts from queue/job config and `Job.retries()`.
- Backoff support:
	- `fixed`
	- `exponential`
	- `full-jitter`
	- `equal-jitter`
	- `decorrelated-jitter`
- Per-job retry decision hook (`Job.retryPolicy(error, context)`).
- Queue-level retry policy rules (`retry.policy`).
- DLQ routing and replay utilities.
- Poison failure templates (`quarantine`, `auto-snooze`, `escalation`).

### Reliability controls
- Queue-level and per-consumer rate limiting.
- Optional distributed/global limiter via storage adapter contract (`consumeRateLimitToken`).
- Backpressure controls and queue-depth gating.
- Circuit breaker controls and half-open behavior.

### Workflows and observability
- DAG flows and dependency-aware execution.
- Batch composition and aggregation.
- Progress reporting via `reportProgress()`.
- Lifecycle event stream emissions.

### Data and deduplication
- Idempotency keys with dedupe window controls.
- Completed-job archival hooks and retention contract support.

## Minimal setup

```ts
import {
	InMemoryQueueStorage,
	Job,
	JobRegistry,
	Supervisor,
	defineQueues,
	defineWorkers,
} from '@vasto-queue/core';

class ExampleJob extends Job<{ value: string }> {
	static jobName = 'example-job';
	override jobName = ExampleJob.jobName;

	override queue() {
		return 'default';
	}

	override async handle(payload: { value: string }) {
		return payload.value;
	}
}

const registry = new JobRegistry();
registry.register(ExampleJob);

const supervisor = new Supervisor({
	queues: defineQueues({
		default: {
			name: 'default',
			connection: 'memory',
			concurrency: 2,
			batchSize: 10,
		},
	}),
	workers: defineWorkers({
		main: {
			queues: ['default'],
			concurrency: 2,
			isolation: 'inline',
		},
	}),
	registry,
	storageAdapters: {
		memory: new InMemoryQueueStorage(),
	},
});
```

## Related docs

- Root usage and package overview: `../../README.md`
- Operations index: `../../docs/operations/README.md`
- Implemented feature catalog: `../../docs/operations/feature-catalog.md`