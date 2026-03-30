# Phase 0: Foundation — Core Job Queue Infrastructure

**Status**: Implemented  
**Scope**: Supervisor, JobManager, JobRegistry, QueueStorage interface, Worker lifecycle, Plugin system, Lifecycle events

## Overview

Phase 0 is the foundational layer that enables all subsequent feature phases. It provides:

1. **Job definition and registry** — typed, named job classes
2. **Orchestration** — supervisor that owns workers and coordinates execution
3. **Storage abstraction** — pluggable backend interface
4. **Worker model** — flexible isolation modes (inline/thread/process) and concurrency
5. **Plugin system** — extensibility hooks for observability, custom behavior
6. **Lifecycle events** — typed event stream for operators
7. **Batch operations** — composition and result tracking for multi-job actions
8. **Progress reporting** — in-job visibility into long-running work
9. **Job archival** — completed job history for audit and debugging

## Architecture

### Job Definition

Jobs are TypeScript classes that inherit from `Job<Payload>`:

```typescript
export class SendEmailJob extends Job<{ userId: string; email: string }> {
  static jobName = 'send-email';
  override jobName = SendEmailJob.jobName;

  override queue(): string {
    return 'emails';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { userId: string; email: string }): Promise<boolean> {
    return await sendEmail(payload.email);
  }
}
```

Jobs must:

- Define a static `jobName` for external reference
- Implement `queue()` to declare which queue they belong to
- Optionally declare `isolation()` for thread/process safety
- Implement `handle()` with typed input and output

### JobRegistry

The registry maps job names to classes for instantiation and execution:

```typescript
const registry = new JobRegistry();
registry.register(SendEmailJob);
registry.register(NotifySlackJob);

const JobClass = registry.get('send-email');
const instance = new JobClass(payload);
```

### Supervisor & JobManager

The **Supervisor** owns:

- **JobManager** — dispatch, execution, scheduling
- **Workers** — ResilientWorker instances for each worker pool
- **Lifecycle event bus** — for observability

The **JobManager** handles:

- Job dispatch to storage
- Job execution and retry logic
- Scheduling (delayed, recurring, cron)
- Batch composition
- Progress reporting

Usage:

```typescript
const supervisor = new Supervisor({
  queues: { emails: { name: 'emails', concurrency: 4 } },
  workers: { main: { queues: ['emails'], isolation: 'inline' } },
  registry,
  storageAdapters: { memory: new InMemoryQueueStorage() },
});

await supervisor.jobManager.dispatch(new SendEmailJob({ userId: 'u_1', email: 'hi@ex.com' }));
await supervisor.start();
```

### QueueStorage Interface

Backends implement the `QueueStorage` interface to provide:

- **Enqueueing** — persist jobs for processing
- **Dequeuing** — lease and retrieve ready jobs
- **State transitions** — move jobs between ready/active/deferred/failed states
- **Failure handling** — dead-letter queues
- **Scheduling** — delayed job queries
- **History** — completed job archival

Implementations:

- **In-memory** — for development/testing
- **Redis** — for production, fully featured
- **Postgres/MySQL** — SQL-based, row-per-job model
- **MongoDB** — document-based, schema-flexible
- **DynamoDB** — serverless, pay-per-request

### Worker Isolation Modes

Workers can execute jobs in three modes:

**Inline**: Job runs in the worker process.

```typescript
{ queues: ['emails'], isolation: 'inline' }
```

- Fastest
- Lowest memory
- Shared memory with worker process (not safe for untrusted code)

**Thread**: Job runs in a worker thread pool.

```typescript
{ queues: ['heavy'], isolation: 'thread', poolSize: 4, workerModule: './worker-thread.js' }
```

- Memory-safe isolation
- Moderate overhead
- Good for CPU-bound compute

**Process**: Job runs in a child process pool.

```typescript
{ queues: ['external'], isolation: 'process', poolSize: 2, workerModule: './worker-process.js' }
```

- Full OS-level isolation
- Safe for untrusted/external code
- Highest overhead and resource use

### Plugin System

Plugins hook into job lifecycle events:

```typescript
export class LoggingPlugin implements Plugin {
  async onEnqueue(job: Job) {
    console.log(`📤 enqueued ${job.jobName}`);
  }

  async onProcessStart(job: StoredJob) {
    console.log(`⏳ started ${job.name}`);
  }

  async onProcessEnd(job: StoredJob, result: any) {
    console.log(`✅ completed ${job.name}`);
  }

  async onFail(job: StoredJob, error: Error) {
    console.error(`❌ failed ${job.name}`, error);
  }

  async onProgress(jobId: string, queueName: string, progress: number) {
    console.log(`📊 ${queueName}/${jobId}: ${progress}%`);
  }
}

const supervisor = new Supervisor({
  queues: { /* ... */ },
  workers: { /* ... */ },
  registry,
  storageAdapters,
  globalPlugins: [new LoggingPlugin()],
});
```

### Lifecycle Events

The supervisor emits typed events for all queue and job transitions:

```typescript
supervisor.on('queue.paused', (event) => {
  console.log(`Queue ${event.queueName} paused`);
});

supervisor.on('job.completed', (event) => {
  console.log(`Job ${event.jobId} completed with result:`, event.result);
});

supervisor.on('job.failed', (event) => {
  console.log(`Job ${event.jobId} failed:`, event.error);
});
```

Events are **replayed** on subscription, so dashboards can reconstruct state without polling.

### Batch Operations

Jobs can be dispatched as a group and tracked together:

```typescript
const batchId = await supervisor.jobManager.dispatchBatch('send-emails', [
  new SendEmailJob({ userId: 'u_1', email: 'alice@ex.com' }),
  new SendEmailJob({ userId: 'u_2', email: 'bob@ex.com' }),
  new SendEmailJob({ userId: 'u_3', email: 'charlie@ex.com' }),
]);

const batch = supervisor.jobManager.getBatch(batchId);
console.log(`${batch.completedJobs}/${batch.totalJobs} done`);
```

### Progress Reporting

Long-running jobs can report progress:

```typescript
export class TranscodeVideoJob extends Job<{ videoId: string }> {
  override async handle(payload: { videoId: string }) {
    await this.reportProgress(0);
    await transcodeVideo(payload.videoId);
    await this.reportProgress(100);
  }
}
```

Progress updates emit lifecycle events and are persisted in storage for dashboard display.

### Completed Job Archival

Completed jobs are stored separately for historical audit and debugging:

```typescript
const completed = await storage.getCompletedJobs({
  queue: 'emails',
  limit: 100,
  offset: 0,
});

completed.forEach((job) => {
  console.log(`${job.id} finished in ${job.duration}ms`);
});
```

## Dependencies & Sequencing

Phase 0 enables all later phases:

- **Phase 1.1–1.4** build on the Job, Registry, Storage, and Supervisor APIs
- **Phase 2** (Dashboard) consumes lifecycle events and storage queries
- **Phase 3** (Flows) use JobManager and Supervisor as orchestration backbone
- **Phase 4** (Adapters & CLI) wrap Phase 0 APIs for different languages/frameworks
- **Phase 5** (Production) adds reliability, security, and observability on top

## Files

- `packages/core/src/contracts/job.ts` — Job base class
- `packages/core/src/libs/supervisor.ts` — Supervisor orchestrator
- `packages/core/src/libs/worker-runtime.ts` — JobManager execution
- `packages/core/src/libs/registry.ts` — Job registry
- `packages/core/src/libs/batch-manager.ts` — Batch tracking
- `packages/core/src/libs/resilient-worker.ts` — Worker loop with backpressure/circuit breaking
- `packages/core/src/interfaces/queue-storage.ts` — Storage contract
- `packages/core/src/interfaces/plugin.ts` — Plugin lifecycle hooks
- `packages/core/src/libs/lifecycle-events.ts` — Event stream and replay
- `packages/core/src/libs/isolation.ts` — Thread/process isolation execution

## Next Steps

Once Phase 0 foundation is stable:

- Phase 1.1 adds delays and scheduling
- Phase 1.2 adds priorities
- Phase 1.3 adds progress tracking (already here)
- Phase 1.4 adds DLQ and failure handling
