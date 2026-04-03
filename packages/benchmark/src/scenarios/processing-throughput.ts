/**
 * Scenario: Processing Throughput
 *
 * Enqueues N jobs then starts workers, measuring total wall-clock time until
 * all N jobs complete. Captures end-to-end ops/sec through the full pipeline.
 *
 * Job payload: { index: number }
 * Job work: no-op (isolates queue overhead from business logic)
 * Batch size per round: 500 jobs
 */

import { Worker as BullMQWorker, Queue as BullMQQueue } from 'bullmq';
import BeeQueue from 'bee-queue';
import {
  InMemoryQueueStorage,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
  Job,
} from '@vasto/core';
import {
  buildReport,
  DEFAULT_OPTIONS,
  meanOf,
  printReport,
  toOps,
} from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';

const JOBS_PER_ROUND = 500;
const SCENARIO = 'processing-throughput';

// ---------------------------------------------------------------------------
// Vasto in-memory
// ---------------------------------------------------------------------------

class NoOpJob extends Job<{ index: number }> {
  static jobName = 'bench-noop';
  override jobName = 'bench-noop';
  override queue() { return 'bench'; }
  override async handle() { /* no-op */ }
}

async function runVastoMemory(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const durations: number[] = [];

  for (let round = 0; round < opts.warmupIterations + opts.iterations; round++) {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(NoOpJob);

    const supervisor = new Supervisor({
      queues: defineQueues({
        bench: { name: 'bench', connection: 'memory', concurrency: opts.concurrency, batchSize: 10 },
      }),
      workers: defineWorkers({ w: { queues: ['bench'], concurrency: opts.concurrency } }),
      registry,
      storageAdapters: { memory: storage },
    });

    for (let i = 0; i < JOBS_PER_ROUND; i++) {
      await supervisor.jobManager.dispatch(new NoOpJob({ index: i }));
    }

    const processed: Promise<void> = new Promise((resolve) => {
      let done = 0;
      supervisor.subscribeLifecycleEvents((evt) => {
        if (evt.type === 'job.completed' || evt.type === 'job.failed') {
          done++;
          if (done >= JOBS_PER_ROUND) resolve();
        }
      });
    });

    const start = performance.now();
    await supervisor.start('worker');
    await processed;
    const elapsed = performance.now() - start;
    supervisor.stop();

    if (round >= opts.warmupIterations) durations.push(elapsed);
  }

  const mean = meanOf(durations);
  return {
    library: 'vasto-memory',
    scenario: SCENARIO,
    iterations: opts.iterations,
    ops: toOps(JOBS_PER_ROUND, mean),
    meanMs: mean,
  };
}

// ---------------------------------------------------------------------------
// BullMQ
// ---------------------------------------------------------------------------

async function runBullMQ(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const durations: number[] = [];

  for (let round = 0; round < opts.warmupIterations + opts.iterations; round++) {
    const queue = new BullMQQueue('bench-bullmq-proc', {
      connection: { url: opts.redisUrl },
    });

    await queue.obliterate({ force: true }).catch(() => {});

    const batch = Array.from({ length: JOBS_PER_ROUND }, (_, i) => ({
      name: 'bench',
      data: { index: i },
    }));
    await queue.addBulk(batch);

    await new Promise<void>((resolve) => {
      let done = 0;
      const worker = new BullMQWorker(
        'bench-bullmq-proc',
        async () => { /* no-op */ },
        { connection: { url: opts.redisUrl }, concurrency: opts.concurrency },
      );
      worker.on('completed', () => { if (++done >= JOBS_PER_ROUND) { void worker.close().then(resolve); } });
      worker.on('failed', () => { if (++done >= JOBS_PER_ROUND) { void worker.close().then(resolve); } });
    });

    const start = performance.now();
    // Re-add and drain for timing (above was setup; reuse queue for timing pass)
    await queue.obliterate({ force: true }).catch(() => {});
    const batchTimed = Array.from({ length: JOBS_PER_ROUND }, (_, i) => ({
      name: 'bench',
      data: { index: i },
    }));
    await queue.addBulk(batchTimed);

    await new Promise<void>((resolve) => {
      let done = 0;
      const worker = new BullMQWorker(
        'bench-bullmq-proc',
        async () => { /* no-op */ },
        { connection: { url: opts.redisUrl }, concurrency: opts.concurrency },
      );
      worker.on('completed', () => { if (++done >= JOBS_PER_ROUND) { void worker.close().then(resolve); } });
      worker.on('failed', () => { if (++done >= JOBS_PER_ROUND) { void worker.close().then(resolve); } });
    });

    const elapsed = performance.now() - start;

    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();

    if (round >= opts.warmupIterations) durations.push(elapsed);
  }

  const mean = meanOf(durations);
  return {
    library: 'bullmq',
    scenario: SCENARIO,
    iterations: opts.iterations,
    ops: toOps(JOBS_PER_ROUND, mean),
    meanMs: mean,
  };
}

// ---------------------------------------------------------------------------
// bee-queue
// ---------------------------------------------------------------------------

async function runBeeQueue(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const durations: number[] = [];

  for (let round = 0; round < opts.warmupIterations + opts.iterations; round++) {
    const producerQ = new BeeQueue('bench-bee-proc', {
      redis: { url: opts.redisUrl },
      isWorker: false,
    });
    const workerQ = new BeeQueue('bench-bee-proc', {
      redis: { url: opts.redisUrl },
      isWorker: true,
    });

    await producerQ.destroy();

    const start = performance.now();

    for (let i = 0; i < JOBS_PER_ROUND; i++) {
      await producerQ.createJob({ index: i }).save();
    }

    await new Promise<void>((resolve) => {
      let done = 0;
      workerQ.process(opts.concurrency, async () => { /* no-op */ });
      workerQ.on('succeeded', () => { if (++done >= JOBS_PER_ROUND) resolve(); });
      workerQ.on('failed', () => { if (++done >= JOBS_PER_ROUND) resolve(); });
    });

    const elapsed = performance.now() - start;

    await workerQ.destroy();
    await producerQ.destroy();

    if (round >= opts.warmupIterations) durations.push(elapsed);
  }

  const mean = meanOf(durations);
  return {
    library: 'bee-queue',
    scenario: SCENARIO,
    iterations: opts.iterations,
    ops: toOps(JOBS_PER_ROUND, mean),
    meanMs: mean,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(opts: ScenarioOptions = {}): Promise<ScenarioReport> {
  const resolved = { ...DEFAULT_OPTIONS, ...opts };
  const results: ScenarioResult[] = [];

  console.log(`\nRunning ${SCENARIO} (${JOBS_PER_ROUND} jobs/round × ${resolved.iterations} rounds)...`);

  results.push(await runVastoMemory(resolved));
  console.log(`  vasto-memory done`);

  if (resolved.redisUrl) {
    results.push(await runBullMQ(resolved));
    console.log(`  bullmq done`);

    results.push(await runBeeQueue(resolved));
    console.log(`  bee-queue done`);
  }

  const report = buildReport(SCENARIO, results);
  printReport(report);
  return report;
}
