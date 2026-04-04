/**
 * Scenario: Enqueue Throughput
 *
 * Measures how many jobs per second each library can enqueue (dispatch to storage)
 * without running any workers. Tests the raw write path.
 *
 * Job payload: { index: number, data: string }
 * Batch size per round: 1000 jobs
 */

import { Queue as BullMQQueue } from 'bullmq';
import BeeQueue from 'bee-queue';
import PgBoss from 'pg-boss';
import { Job } from '@vasto/core';
import {
  buildReport,
  DEFAULT_OPTIONS,
  meanOf,
  printReport,
  runRounds,
  toOps,
  withTimeout,
} from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';
import { createVastoFixture } from '../vasto-fixture.js';

const JOBS_PER_ROUND = 1000;
const ENQUEUE_CHUNK_SIZE = JOBS_PER_ROUND;
const SCENARIO = 'enqueue-throughput';

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

// ---------------------------------------------------------------------------
// Vasto in-memory
// ---------------------------------------------------------------------------

class BenchJob extends Job<{ index: number; data: string }> {
  static jobName = 'bench-enqueue';
  override jobName = 'bench-enqueue';
  override queue() { return 'bench'; }
  override async handle() { /* no-op */ }
}

async function runVasto(
  backend: 'memory' | 'redis' | 'postgres',
  opts: Required<ScenarioOptions>,
  runOptions?: {
    partitionByQueue?: boolean;
    libraryOverride?: ScenarioResult['library'];
  },
): Promise<ScenarioResult> {
  const fixture = await createVastoFixture({
    backend,
    jobClass: BenchJob,
    concurrency: 1,
    batchSize: 10,
    enqueueChunkSize: JOBS_PER_ROUND,
    ...(runOptions?.partitionByQueue != null ? { partitionByQueue: runOptions.partitionByQueue } : {}),
    redisUrl: opts.redisUrl,
    postgresUrl: opts.postgresUrl,
  });

  try {
    const durations = await runRounds(async () => {
      for (let start = 0; start < JOBS_PER_ROUND; start += ENQUEUE_CHUNK_SIZE) {
        const end = Math.min(start + ENQUEUE_CHUNK_SIZE, JOBS_PER_ROUND);
        const jobs = Array.from(
          { length: end - start },
          (_, offset) => new BenchJob({ index: start + offset, data: 'benchmark-payload' }),
        );

        if (typeof fixture.supervisor.jobManager.dispatchMany === 'function') {
          await fixture.supervisor.jobManager.dispatchMany(jobs);
        } else {
          await Promise.all(jobs.map((job) => fixture.supervisor.jobManager.dispatch(job)));
        }
      }
    }, opts);

    const mean = meanOf(durations);
    return {
      library: runOptions?.libraryOverride ?? fixture.library,
      scenario: SCENARIO,
      iterations: opts.iterations,
      ops: toOps(JOBS_PER_ROUND, mean),
      meanMs: mean,
    };
  } finally {
    await fixture.cleanup();
  }
}

// ---------------------------------------------------------------------------
// BullMQ
// ---------------------------------------------------------------------------

async function runBullMQ(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const queue = new BullMQQueue('bench-bullmq', {
    connection: { url: opts.redisUrl },
  });

  // Drain existing jobs for a clean run
  await queue.obliterate({ force: true }).catch(() => {});

  const durations = await runRounds(async () => {
    const batch = Array.from({ length: JOBS_PER_ROUND }, (_, i) => ({
      name: 'bench',
      data: { index: i, data: 'benchmark-payload' },
    }));
    await queue.addBulk(batch);
  }, opts);

  await queue.obliterate({ force: true }).catch(() => {});
  await queue.close();

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
    const queueName = `bench-bee-enqueue-${round}-${Date.now()}`;
    const queue = new BeeQueue(queueName, {
      redis: { url: opts.redisUrl },
      isWorker: false,
      getEvents: false,
      storeJobs: false,
    });
    await queue.ready();

    const duration = await measureBeeEnqueueRound(queue, round);

    await queue.destroy().catch(() => {});
    await queue.close(0).catch(() => {});

    if (round >= opts.warmupIterations) {
      durations.push(duration);
    }
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

async function measureBeeEnqueueRound(queue: BeeQueue, round: number): Promise<number> {
  const start = performance.now();
  await withTimeout(
    Promise.all(
      Array.from({ length: JOBS_PER_ROUND }, (_, i) =>
        queue.createJob({ index: i, data: 'benchmark-payload', round }).save(),
      ),
    ).then(() => undefined),
    30000,
    'bee-queue enqueue round',
  );
  return performance.now() - start;
}

// ---------------------------------------------------------------------------
// pg-boss
// ---------------------------------------------------------------------------

async function runPgBoss(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const boss = new PgBoss(opts.postgresUrl);
  await boss.start();
  await boss.deleteQueue('bench-pgboss').catch(() => {});

  const durations = await runRounds(async () => {
    const batch = Array.from({ length: JOBS_PER_ROUND }, (_, i) => ({
      data: { index: i, data: 'benchmark-payload' },
    }));
    await boss.insert(batch.map((b) => ({ name: 'bench-pgboss', data: b.data })));
  }, opts);

  await boss.deleteQueue('bench-pgboss').catch(() => {});
  await boss.stop();

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
    if (envFlag('VASTO_BENCH_COMPARE_PARTITIONS')) {
      results.push(await runVasto('postgres', resolved, {
        partitionByQueue: false,
        libraryOverride: 'vasto-postgres-unpartitioned',
      }));
      console.log(`  vasto-postgres-unpartitioned done`);

      results.push(await runVasto('postgres', resolved, {
        partitionByQueue: true,
        libraryOverride: 'vasto-postgres-partitioned',
      }));
      console.log(`  vasto-postgres-partitioned done`);
    } else {
      results.push(await runVasto('postgres', resolved));
      console.log(`  vasto-postgres done`);
    }

    results.push(await runPgBoss(resolved));
    console.log(`  pg-boss done`);
  }

  const report = buildReport(SCENARIO, results);
  printReport(report);
  return report;
}
