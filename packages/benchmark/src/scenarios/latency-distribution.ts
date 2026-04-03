/**
 * Scenario: Latency Distribution
 *
 * Measures the time from job dispatch to job execution start (p50/p95/p99/max).
 * One job at a time (concurrency 1) to isolate queueing latency from
 * processing parallelism. 200 individual job latencies are collected per library.
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
  percentiles,
  meanOf,
  printReport,
  withTimeout,
} from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';

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

async function runVastoMemory(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const latencies: number[] = [];

  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(LatencyJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ bench: { name: 'bench', connection: 'memory', concurrency: 1, batchSize: 5 } }),
    workers: defineWorkers({ w: { queues: ['bench'], concurrency: 1 } }),
    registry,
    storageAdapters: { memory: storage },
  });

  await supervisor.start('worker');

  for (let i = 0; i < SAMPLE_SIZE + opts.warmupIterations; i++) {
    const enqueuedAt = performance.now();
    await new Promise<void>((resolve) => {
      const unsub = supervisor.subscribeLifecycleEvents((evt) => {
        if (evt.type === 'job.started') {
          const latency = performance.now() - enqueuedAt;
          if (i >= opts.warmupIterations) latencies.push(latency);
          unsub();
          resolve();
        }
      });
      void supervisor.jobManager.dispatch(new LatencyJob({ enqueuedAt }));
    });
  }

  supervisor.stop();

  return {
    library: 'vasto-memory',
    scenario: SCENARIO,
    iterations: SAMPLE_SIZE,
    latency: percentiles(latencies) ?? { p50: 0, p95: 0, p99: 0, max: 0 },
    meanMs: meanOf(latencies),
  };
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
// Entry point
// ---------------------------------------------------------------------------

export async function run(opts: ScenarioOptions = {}): Promise<ScenarioReport> {
  const resolved = { ...DEFAULT_OPTIONS, ...opts };
  const results: ScenarioResult[] = [];

  console.log(`\nRunning ${SCENARIO} (${SAMPLE_SIZE} samples, concurrency 1)...`);

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
