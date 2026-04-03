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
  runRounds,
  toOps,
} from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';

const JOBS_PER_ROUND = 1000;
const SCENARIO = 'enqueue-throughput';

// ---------------------------------------------------------------------------
// Vasto in-memory
// ---------------------------------------------------------------------------

class BenchJob extends Job<{ index: number; data: string }> {
  static jobName = 'bench-enqueue';
  override jobName = 'bench-enqueue';
  override queue() { return 'bench'; }
  override async handle() { /* no-op */ }
}

async function runVastoMemory(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(BenchJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ bench: { name: 'bench', connection: 'memory', concurrency: 1, batchSize: 10 } }),
    workers: defineWorkers({ w: { queues: ['bench'], concurrency: 1 } }),
    registry,
    storageAdapters: { memory: storage },
  });

  const durations = await runRounds(async () => {
    for (let i = 0; i < JOBS_PER_ROUND; i++) {
      await supervisor.jobManager.dispatch(new BenchJob({ index: i, data: 'benchmark-payload' }));
    }
  }, opts);

  await storage.clear?.();

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
  const queue = new BeeQueue('bench-bee', {
    redis: { url: opts.redisUrl },
    isWorker: false,
  });

  const durations = await runRounds(async () => {
    const jobs = Array.from({ length: JOBS_PER_ROUND }, (_, i) =>
      queue.createJob({ index: i, data: 'benchmark-payload' }).save(),
    );
    await Promise.all(jobs);
  }, opts);

  await queue.destroy();

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

  results.push(await runVastoMemory(resolved));
  console.log(`  vasto-memory done`);

  if (resolved.redisUrl) {
    results.push(await runBullMQ(resolved));
    console.log(`  bullmq done`);

    results.push(await runBeeQueue(resolved));
    console.log(`  bee-queue done`);
  }

  if (resolved.postgresUrl) {
    results.push(await runPgBoss(resolved));
    console.log(`  pg-boss done`);
  }

  const report = buildReport(SCENARIO, results);
  printReport(report);
  return report;
}
