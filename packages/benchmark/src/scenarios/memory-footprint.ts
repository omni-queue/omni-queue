/**
 * Scenario: Memory Footprint
 *
 * Enqueues 10,000 jobs without running any workers, then measures peak RSS.
 * Shows how each library holds queued jobs in memory at rest.
 *
 * Note: For Redis-backed libraries the bulk of job data lives in Redis, so
 * RSS reflects client-side overhead only.
 */

import { Queue as BullMQQueue } from 'bullmq';
import BeeQueue from 'bee-queue';
import PgBoss from 'pg-boss';
import { Job } from '@vasto-queue/core';
import { buildReport, DEFAULT_OPTIONS, printReport, rssInMb, withTimeout } from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';
import { createVastoFixture } from '../vasto-fixture.js';

const JOB_COUNT = 10_000;
const SCENARIO = 'memory-footprint';

class MemJob extends Job<{ index: number; data: string }> {
  static jobName = 'bench-mem';
  override jobName = 'bench-mem';
  override queue() { return 'bench'; }
  override async handle() { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Vasto in-memory
// ---------------------------------------------------------------------------

async function runVasto(
  backend: 'memory' | 'redis' | 'postgres',
  opts: Required<ScenarioOptions>,
): Promise<ScenarioResult> {
  const fixture = await createVastoFixture({
    backend,
    jobClass: MemJob,
    concurrency: 1,
    batchSize: 10,
    redisUrl: opts.redisUrl,
    postgresUrl: opts.postgresUrl,
  });

  try {
    const baselineMb = rssInMb();
    let peakMb = baselineMb;

    for (let i = 0; i < JOB_COUNT; i++) {
      await fixture.supervisor.jobManager.dispatch(new MemJob({ index: i, data: 'benchmark-payload-memory-test' }));
      if (i % 250 === 0) {
        peakMb = Math.max(peakMb, rssInMb());
      }
    }

    await new Promise((r) => setTimeout(r, 200));
    peakMb = Math.max(peakMb, rssInMb());

    return {
      library: fixture.library,
      scenario: SCENARIO,
      iterations: 1,
      memoryMb: Math.max(0, peakMb - baselineMb),
      meta: {
        totalRssMb: peakMb,
        baselineMb,
        jobCount: JOB_COUNT,
        ...(backend === 'memory' ? {} : { note: 'client-side overhead only' }),
      },
    };
  } finally {
    await fixture.cleanup();
  }
}

// ---------------------------------------------------------------------------
// BullMQ
// ---------------------------------------------------------------------------

async function runBullMQ(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const queue = new BullMQQueue('bench-bullmq-mem', {
    connection: { url: opts.redisUrl },
  });
  await queue.obliterate({ force: true }).catch(() => {});

  const baselineMb = rssInMb();
  let peakMb = baselineMb;

  const batch = Array.from({ length: JOB_COUNT }, (_, i) => ({
    name: 'bench',
    data: { index: i, data: 'benchmark-payload-memory-test' },
  }));
  await queue.addBulk(batch);

  await new Promise((r) => setTimeout(r, 200));
  peakMb = Math.max(peakMb, rssInMb());

  await queue.obliterate({ force: true }).catch(() => {});
  await queue.close();

  return {
    library: 'bullmq',
    scenario: SCENARIO,
    iterations: 1,
    memoryMb: Math.max(0, peakMb - baselineMb),
    meta: { totalRssMb: peakMb, baselineMb, jobCount: JOB_COUNT, note: 'client-side overhead only' },
  };
}

// ---------------------------------------------------------------------------
// bee-queue
// ---------------------------------------------------------------------------

async function runBeeQueue(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const queue = new BeeQueue(`bench-bee-mem-${Date.now()}`, {
    redis: { url: opts.redisUrl },
    isWorker: false,
    getEvents: false,
  });
  await queue.ready();

  const baselineMb = rssInMb();
  let peakMb = baselineMb;

  await withTimeout(
    (async () => {
      for (let i = 0; i < JOB_COUNT; i++) {
        await queue.createJob({ index: i, data: 'benchmark-payload-memory-test' }).save();
        if (i % 250 === 0) {
          peakMb = Math.max(peakMb, rssInMb());
        }
      }
    })(),
    30000,
    'bee-queue memory round',
  );

  await new Promise((r) => setTimeout(r, 200));
  peakMb = Math.max(peakMb, rssInMb());

  await queue.destroy().catch(() => {});
  await queue.close(0).catch(() => {});

  return {
    library: 'bee-queue',
    scenario: SCENARIO,
    iterations: 1,
    memoryMb: Math.max(0, peakMb - baselineMb),
    meta: { totalRssMb: peakMb, baselineMb, jobCount: JOB_COUNT, note: 'client-side overhead only' },
  };
}

// ---------------------------------------------------------------------------
// pg-boss
// ---------------------------------------------------------------------------

async function runPgBoss(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const queueName = `bench-pgboss-mem-${Date.now()}`;
  const boss = new PgBoss(opts.postgresUrl);

  await boss.start();
  await boss.deleteQueue(queueName).catch(() => {});
  await boss.createQueue(queueName).catch(() => {});

  const baselineMb = rssInMb();
  let peakMb = baselineMb;

  const batch = Array.from({ length: JOB_COUNT }, (_, i) => ({
    name: queueName,
    data: { index: i, data: 'benchmark-payload-memory-test' },
  }));

  await boss.insert(batch);
  await new Promise((r) => setTimeout(r, 200));
  peakMb = Math.max(peakMb, rssInMb());

  await boss.purgeQueue(queueName).catch(() => {});
  await boss.deleteQueue(queueName).catch(() => {});
  await boss.stop();

  return {
    library: 'pg-boss',
    scenario: SCENARIO,
    iterations: 1,
    memoryMb: Math.max(0, peakMb - baselineMb),
    meta: { totalRssMb: peakMb, baselineMb, jobCount: JOB_COUNT, note: 'client-side overhead only' },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(opts: ScenarioOptions = {}): Promise<ScenarioReport> {
  const resolved = { ...DEFAULT_OPTIONS, ...opts };
  const results: ScenarioResult[] = [];

  console.log(`\nRunning ${SCENARIO} (${JOB_COUNT.toLocaleString()} queued jobs, no workers)...`);

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

  // Footnote
  const report = buildReport(SCENARIO, results);
  printReport(report);
  console.log('> Note: RSS delta for Redis-backed and Postgres-backed libraries mostly reflects client heap only; queued job data lives in the remote store.\n');
  return report;
}
