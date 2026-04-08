/**
 * Scenario: Latency Distribution
 *
 * Measures the time from job dispatch to job execution start (p50/p95/p99/max).
 * One job at a time (concurrency 1) to isolate queueing latency from
 * processing parallelism. 200 individual job latencies are collected per library.
 */

import { Worker as BullMQWorker, Queue as BullMQQueue } from 'bullmq';
import BeeQueue from 'bee-queue';
import PgBoss from 'pg-boss';
import { Job } from '@vasto-queue/core';
import {
  buildReport,
  DEFAULT_OPTIONS,
  percentiles,
  meanOf,
  printReport,
  withTimeout,
} from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';
import { createVastoFixture } from '../vasto-fixture.js';

const SAMPLE_SIZE = 200;
const SCENARIO = 'latency-distribution';

// ---------------------------------------------------------------------------
// Vasto in-memory
// ---------------------------------------------------------------------------

class LatencyJob extends Job<{ enqueuedAt: number }> {
  static jobName = 'bench-latency';
  override jobName = 'bench-latency';
  override queue() { return 'bench'; }
  override async handle() { /* latency measured externally */ }
}

async function runVasto(
  backend: 'memory' | 'redis' | 'postgres',
  opts: Required<ScenarioOptions>,
): Promise<ScenarioResult> {
  const latencies: number[] = [];

  const fixture = await createVastoFixture({
    backend,
    jobClass: LatencyJob,
    concurrency: 1,
    batchSize: 5,
    redisUrl: opts.redisUrl,
    postgresUrl: opts.postgresUrl,
  });

  try {
    await fixture.supervisor.start('worker');

    for (let i = 0; i < SAMPLE_SIZE + opts.warmupIterations; i++) {
      const enqueuedAt = performance.now();
      await new Promise<void>((resolve) => {
        const unsub = fixture.supervisor.subscribeLifecycleEvents((evt) => {
          if (evt.type === 'job.started') {
            const latency = performance.now() - enqueuedAt;
            if (i >= opts.warmupIterations) latencies.push(latency);
            unsub();
            resolve();
          }
        });
        void fixture.supervisor.jobManager.dispatch(new LatencyJob({ enqueuedAt }));
      });
    }

    return {
      library: fixture.library,
      scenario: SCENARIO,
      iterations: SAMPLE_SIZE,
      latency: percentiles(latencies) ?? { p50: 0, p95: 0, p99: 0, max: 0 },
      meanMs: meanOf(latencies),
    };
  } finally {
    await fixture.cleanup();
  }
}

// ---------------------------------------------------------------------------
// BullMQ
// ---------------------------------------------------------------------------

async function runBullMQ(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const latencies: number[] = [];

  const queue = new BullMQQueue('bench-bullmq-lat', {
    connection: { url: opts.redisUrl },
  });

  await queue.obliterate({ force: true }).catch(() => {});

  let sampleCount = 0;
  const total = SAMPLE_SIZE + opts.warmupIterations;

  await new Promise<void>((resolve) => {
    const worker = new BullMQWorker(
      'bench-bullmq-lat',
      async (job) => {
        const latency = performance.now() - (job.data.enqueuedAt as number);
        if (sampleCount >= opts.warmupIterations) latencies.push(latency);
        sampleCount++;
        if (sampleCount >= total) void worker.close().then(resolve);
      },
      { connection: { url: opts.redisUrl }, concurrency: 1 },
    );

    // Dispatch jobs with a small stagger so worker doesn't batch-dequeue
    (async () => {
      for (let i = 0; i < total; i++) {
        await queue.add('bench', { enqueuedAt: performance.now() });
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
  });

  await queue.obliterate({ force: true }).catch(() => {});
  await queue.close();

  return {
    library: 'bullmq',
    scenario: SCENARIO,
    iterations: SAMPLE_SIZE,
    latency: percentiles(latencies) ?? { p50: 0, p95: 0, p99: 0, max: 0 },
    meanMs: meanOf(latencies),
  };
}

// ---------------------------------------------------------------------------
// bee-queue
// ---------------------------------------------------------------------------

async function runBeeQueue(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const latencies: number[] = [];

  const queueName = `bench-bee-lat-${Date.now()}`;
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

  let sampleCount = 0;
  const total = SAMPLE_SIZE + opts.warmupIterations;

  await withTimeout(
    new Promise<void>((resolve) => {
      workerQ.process(1, async (job: BeeQueue.Job<{ enqueuedAt: number }>) => {
        const latency = performance.now() - job.data.enqueuedAt;
        if (sampleCount >= opts.warmupIterations) latencies.push(latency);
        sampleCount++;
        if (sampleCount >= total) resolve();
      });

      (async () => {
        for (let i = 0; i < total; i++) {
          await producerQ.createJob({ enqueuedAt: performance.now() }).save();
          await new Promise((r) => setTimeout(r, 5));
        }
      })();
    }),
    30000,
    'bee-queue latency round',
  );

  await workerQ.destroy().catch(() => {});
  await producerQ.destroy().catch(() => {});
  await workerQ.close(0).catch(() => {});
  await producerQ.close(0).catch(() => {});

  return {
    library: 'bee-queue',
    scenario: SCENARIO,
    iterations: SAMPLE_SIZE,
    latency: percentiles(latencies) ?? { p50: 0, p95: 0, p99: 0, max: 0 },
    meanMs: meanOf(latencies),
  };
}

// ---------------------------------------------------------------------------
// pg-boss
// ---------------------------------------------------------------------------

async function runPgBoss(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const latencies: number[] = [];
  const queueName = `bench-pgboss-lat-${Date.now()}`;
  const boss = new PgBoss(opts.postgresUrl);

  await boss.start();
  await boss.deleteQueue(queueName).catch(() => {});
  await boss.createQueue(queueName).catch(() => {});

  const total = SAMPLE_SIZE + opts.warmupIterations;
  let sampleCount = 0;

  await withTimeout(
    new Promise<void>(async (resolve) => {
      await boss.work(
        queueName,
        {
          batchSize: 100,
          pollingIntervalSeconds: 0.5,
        },
        async (jobs: Array<{ data?: { enqueuedAt?: number } }>) => {
          for (const job of jobs) {
            const enqueuedAt = job.data?.enqueuedAt;
            if (typeof enqueuedAt !== 'number') {
              continue;
            }

            const latency = performance.now() - enqueuedAt;
            if (sampleCount >= opts.warmupIterations) {
              latencies.push(latency);
            }
            sampleCount += 1;

            if (sampleCount >= total) {
              resolve();
              return;
            }
          }
        },
      );

      for (let i = 0; i < total; i++) {
        await boss.insert([{ name: queueName, data: { enqueuedAt: performance.now() } }]);
        await new Promise((r) => setTimeout(r, 5));
      }
    }),
    60000,
    'pg-boss latency round',
  );

  await boss.offWork(queueName).catch(() => {});
  await boss.deleteQueue(queueName).catch(() => {});
  await boss.stop();

  return {
    library: 'pg-boss',
    scenario: SCENARIO,
    iterations: SAMPLE_SIZE,
    latency: percentiles(latencies) ?? { p50: 0, p95: 0, p99: 0, max: 0 },
    meanMs: meanOf(latencies),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(opts: ScenarioOptions = {}): Promise<ScenarioReport> {
  const resolved = { ...DEFAULT_OPTIONS, ...opts };
  const results: ScenarioResult[] = [];

  console.log(`\nRunning ${SCENARIO} (${SAMPLE_SIZE} samples, concurrency 1)...`);

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
