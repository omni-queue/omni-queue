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
import PgBoss from 'pg-boss';
import { Job } from '@vasto/core';
import {
  buildReport,
  DEFAULT_OPTIONS,
  meanOf,
  printReport,
  toOps,
  withTimeout,
} from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';
import { createVastoFixture } from '../vasto-fixture.js';

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

async function runVasto(
  backend: 'memory' | 'redis' | 'postgres',
  opts: Required<ScenarioOptions>,
): Promise<ScenarioResult> {
  const durations: number[] = [];

  for (let round = 0; round < opts.warmupIterations + opts.iterations; round++) {
    const fixture = await createVastoFixture({
      backend,
      jobClass: NoOpJob,
      concurrency: opts.concurrency,
      batchSize: 10,
      redisUrl: opts.redisUrl,
      postgresUrl: opts.postgresUrl,
    });

    try {
      for (let i = 0; i < JOBS_PER_ROUND; i++) {
        await fixture.supervisor.jobManager.dispatch(new NoOpJob({ index: i }));
      }

      const processed: Promise<void> = new Promise((resolve) => {
        let done = 0;
        fixture.supervisor.subscribeLifecycleEvents((evt) => {
          if (evt.type === 'job.completed' || evt.type === 'job.failed') {
            done++;
            if (done >= JOBS_PER_ROUND) resolve();
          }
        });
      });

      const start = performance.now();
      await fixture.supervisor.start('worker');
      await processed;
      const elapsed = performance.now() - start;

      if (round >= opts.warmupIterations) durations.push(elapsed);
    } finally {
      await fixture.cleanup();
    }
  }

  const mean = meanOf(durations);
  return {
    library: backend === 'memory' ? 'vasto-memory' : backend === 'redis' ? 'vasto-redis' : 'vasto-postgres',
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
    const queueName = `bench-bee-proc-${round}-${Date.now()}`;
    const producerQ = new BeeQueue(queueName, {
      redis: { url: opts.redisUrl },
      isWorker: false,
      getEvents: false,
    });
    const workerQ = new BeeQueue(queueName, {
      redis: { url: opts.redisUrl },
      isWorker: true,
      getEvents: true,
    });
    await producerQ.ready();
    await workerQ.ready();

    const start = performance.now();

    for (let i = 0; i < JOBS_PER_ROUND; i++) {
      await producerQ.createJob({ index: i }).save();
    }

    await withTimeout(
      new Promise<void>((resolve) => {
        let done = 0;
        const onSettled = () => {
          done++;
          if (done >= JOBS_PER_ROUND) {
            workerQ.removeListener('succeeded', onSettled);
            workerQ.removeListener('failed', onSettled);
            resolve();
          }
        };

        workerQ.on('succeeded', onSettled);
        workerQ.on('failed', onSettled);
        workerQ.process(opts.concurrency, async () => { /* no-op */ });
      }),
      30000,
      'bee-queue processing round',
    );

    const elapsed = performance.now() - start;

    await workerQ.destroy().catch(() => {});
    await producerQ.destroy().catch(() => {});
    await workerQ.close(0).catch(() => {});
    await producerQ.close(0).catch(() => {});

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
// pg-boss
// ---------------------------------------------------------------------------

async function runPgBoss(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const durations: number[] = [];
  const queueName = 'bench-pgboss-proc';
  const boss = new PgBoss(opts.postgresUrl);

  await boss.start();
  await boss.deleteQueue(queueName).catch(() => {});
  await boss.createQueue(queueName).catch(() => {});

  try {
    for (let round = 0; round < opts.warmupIterations + opts.iterations; round++) {
      await boss.purgeQueue(queueName).catch(() => {});

      let done = 0;
      let resolveProcessed!: () => void;
      const processed = new Promise<void>((resolve) => {
        resolveProcessed = resolve;
      });

      await boss.work(
        queueName,
        {
          batchSize: 100,
          pollingIntervalSeconds: 0.5,
        },
        async (jobs: Array<{ id: string }>) => {
          done += jobs.length;
          if (done >= JOBS_PER_ROUND) {
            resolveProcessed();
          }
        },
      );

      const start = performance.now();
      const batch = Array.from({ length: JOBS_PER_ROUND }, (_, i) => ({
        name: queueName,
        data: { index: i },
      }));

      await boss.insert(batch);
      await withTimeout(processed, 30000, 'pg-boss processing round');
      const elapsed = performance.now() - start;

      await boss.offWork(queueName).catch(() => {});
      if (round >= opts.warmupIterations) durations.push(elapsed);
    }
  } finally {
    await boss.offWork(queueName).catch(() => {});
    await boss.deleteQueue(queueName).catch(() => {});
    await boss.stop();
  }

  const mean = meanOf(durations);
  return {
    library: 'pg-boss',
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

  results.push(await runVasto('memory', resolved));
  console.log(`  vasto-memory done`);

  if (resolved.redisUrl) {
    results.push(await runVasto('redis', resolved));
    console.log(`  vasto-redis done`);

    results.push(await runBullMQ(resolved));
    console.log(`  bullmq done`);

    results.push(await runBeeQueue(resolved));
    console.log(`  bee-queue done`);
  }

  if (resolved.postgresUrl) {
    results.push(await runVasto('postgres', resolved));
    console.log(`  vasto-postgres done`);

    results.push(await runPgBoss(resolved));
    console.log(`  pg-boss done`);
  }

  const report = buildReport(SCENARIO, results);
  printReport(report);
  return report;
}
