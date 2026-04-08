/**
 * Scenario: Concurrency Scaling
 *
 * Runs the processing-throughput scenario at each concurrency level:
 * 1 / 5 / 10 / 25. Shows how each library scales with more parallel workers.
 *
 * Job payload: { index: number }
 * Batch size per round: 500 jobs
 */

import { Worker as BullMQWorker, Queue as BullMQQueue } from 'bullmq';
import PgBoss from 'pg-boss';
import { Job } from '@vasto-queue/core';
import {
  buildReport,
  DEFAULT_OPTIONS,
  meanOf,
  toOps,
  withTimeout,
} from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';
import { createVastoFixture } from '../vasto-fixture.js';

const JOBS_PER_ROUND = 500;
const CONCURRENCY_LEVELS = [1, 5, 10, 25];
const SCENARIO = 'concurrency-scaling';

class ConcurrencyJob extends Job<{ index: number }> {
  static jobName = 'bench-concurrency';
  override jobName = 'bench-concurrency';
  override queue() { return 'bench'; }
  override async handle() { /* no-op */ }
}

async function vastoAtConcurrency(
  backend: 'memory' | 'redis' | 'postgres',
  concurrency: number,
  opts: Required<ScenarioOptions>,
): Promise<number> {
  const durations: number[] = [];

  for (let round = 0; round < opts.warmupIterations + opts.iterations; round++) {
    const fixture = await createVastoFixture({
      backend,
      jobClass: ConcurrencyJob,
      concurrency,
      batchSize: 10,
      redisUrl: opts.redisUrl,
      postgresUrl: opts.postgresUrl,
    });

    try {
      for (let i = 0; i < JOBS_PER_ROUND; i++) {
        await fixture.supervisor.jobManager.dispatch(new ConcurrencyJob({ index: i }));
      }

      const processed = new Promise<void>((resolve) => {
        let done = 0;
        fixture.supervisor.subscribeLifecycleEvents((evt) => {
          if (evt.type === 'job.completed' || evt.type === 'job.failed') {
            if (++done >= JOBS_PER_ROUND) resolve();
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

  return meanOf(durations);
}

async function bullmqAtConcurrency(
  concurrency: number,
  opts: Required<ScenarioOptions>,
): Promise<number> {
  const durations: number[] = [];

  for (let round = 0; round < opts.warmupIterations + opts.iterations; round++) {
    const queue = new BullMQQueue('bench-bullmq-conc', {
      connection: { url: opts.redisUrl },
    });

    await queue.obliterate({ force: true }).catch(() => {});

    const batch = Array.from({ length: JOBS_PER_ROUND }, (_, i) => ({
      name: 'bench',
      data: { index: i },
    }));
    await queue.addBulk(batch);

    const start = performance.now();

    await new Promise<void>((resolve) => {
      let done = 0;
      const worker = new BullMQWorker(
        'bench-bullmq-conc',
        async () => { /* no-op */ },
        { connection: { url: opts.redisUrl }, concurrency },
      );
      worker.on('completed', () => { if (++done >= JOBS_PER_ROUND) void worker.close().then(resolve); });
      worker.on('failed', () => { if (++done >= JOBS_PER_ROUND) void worker.close().then(resolve); });
    });

    const elapsed = performance.now() - start;
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();

    if (round >= opts.warmupIterations) durations.push(elapsed);
  }

  return meanOf(durations);
}

async function pgbossAtConcurrency(
  concurrency: number,
  opts: Required<ScenarioOptions>,
): Promise<number> {
  const durations: number[] = [];
  const queueName = `bench-pgboss-conc-${concurrency}`;
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

      for (let workerIndex = 0; workerIndex < concurrency; workerIndex++) {
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
      }

      const start = performance.now();
      const batch = Array.from({ length: JOBS_PER_ROUND }, (_, i) => ({
        name: queueName,
        data: { index: i },
      }));
      await boss.insert(batch);

      await withTimeout(processed, 120000, 'pg-boss concurrency round');
      const elapsed = performance.now() - start;

      await boss.offWork(queueName).catch(() => {});
      if (round >= opts.warmupIterations) durations.push(elapsed);
    }
  } finally {
    await boss.offWork(queueName).catch(() => {});
    await boss.deleteQueue(queueName).catch(() => {});
    await boss.stop();
  }

  return meanOf(durations);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(opts: ScenarioOptions = {}): Promise<ScenarioReport> {
  const resolved = { ...DEFAULT_OPTIONS, ...opts };
  const results: ScenarioResult[] = [];

  console.log(`\nRunning ${SCENARIO} at concurrency levels [${CONCURRENCY_LEVELS.join(', ')}]...`);

  for (const c of CONCURRENCY_LEVELS) {
    const vastoMean = await vastoAtConcurrency('memory', c, resolved);
    results.push({
      library: 'vasto-memory',
      scenario: SCENARIO,
      iterations: resolved.iterations,
      ops: toOps(JOBS_PER_ROUND, vastoMean),
      meanMs: vastoMean,
      meta: { concurrency: c },
    });
    console.log(`  vasto-memory concurrency=${c} done`);

    if (resolved.redisUrl) {
      const vastoRedisMean = await vastoAtConcurrency('redis', c, resolved);
      results.push({
        library: 'vasto-redis',
        scenario: SCENARIO,
        iterations: resolved.iterations,
        ops: toOps(JOBS_PER_ROUND, vastoRedisMean),
        meanMs: vastoRedisMean,
        meta: { concurrency: c },
      });
      console.log(`  vasto-redis concurrency=${c} done`);
    }

    if (resolved.postgresUrl) {
      const vastoPostgresMean = await vastoAtConcurrency('postgres', c, resolved);
      results.push({
        library: 'vasto-postgres',
        scenario: SCENARIO,
        iterations: resolved.iterations,
        ops: toOps(JOBS_PER_ROUND, vastoPostgresMean),
        meanMs: vastoPostgresMean,
        meta: { concurrency: c },
      });
      console.log(`  vasto-postgres concurrency=${c} done`);

      const pgbossMean = await pgbossAtConcurrency(c, resolved);
      results.push({
        library: 'pg-boss',
        scenario: SCENARIO,
        iterations: resolved.iterations,
        ops: toOps(JOBS_PER_ROUND, pgbossMean),
        meanMs: pgbossMean,
        meta: { concurrency: c },
      });
      console.log(`  pg-boss concurrency=${c} done`);
    }

    if (resolved.redisUrl) {
      const bullMean = await bullmqAtConcurrency(c, resolved);
      results.push({
        library: 'bullmq',
        scenario: SCENARIO,
        iterations: resolved.iterations,
        ops: toOps(JOBS_PER_ROUND, bullMean),
        meanMs: bullMean,
        meta: { concurrency: c },
      });
      console.log(`  bullmq concurrency=${c} done`);
    }
  }

  // Custom table: concurrency as rows
  const report = buildReport(SCENARIO, results);
  console.log(`\n## ${report.scenario}`);
  console.log(`Run at: ${report.runAt} | Node: ${report.nodeVersion}\n`);
  const libraries = ['vasto-memory'];
  if (resolved.redisUrl) libraries.push('vasto-redis', 'bullmq');
  if (resolved.postgresUrl) libraries.push('vasto-postgres', 'pg-boss');
  console.log(`| concurrency | ${libraries.map((library) => `${library} ops/sec`).join(' | ')} |`);
  console.log(`|------------:|${libraries.map(() => '---------------------:').join('|')}|`);

  for (const c of CONCURRENCY_LEVELS) {
    const row = libraries.map((library) => {
      const result = results.find((entry) => entry.library === library && entry.meta?.['concurrency'] === c);
      return String(result?.ops ?? '-');
    });
    console.log(`| ${c} | ${row.join(' | ')} |`);
  }
  console.log('');
  return report;
}
