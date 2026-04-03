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
import {
  InMemoryQueueStorage,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
  Job,
} from '@vasto/core';
import { buildReport, DEFAULT_OPTIONS, printReport, rssInMb, withTimeout } from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';

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

async function runVastoMemory(): Promise<ScenarioResult> {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(MemJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ bench: { name: 'bench', connection: 'memory', concurrency: 1, batchSize: 10 } }),
    workers: defineWorkers({ w: { queues: ['bench'], concurrency: 1 } }),
    registry,
    storageAdapters: { memory: storage },
  });

  const baselineMb = rssInMb();
  let peakMb = baselineMb;

  for (let i = 0; i < JOB_COUNT; i++) {
    await supervisor.jobManager.dispatch(new MemJob({ index: i, data: 'benchmark-payload-memory-test' }));
    if (i % 250 === 0) {
      peakMb = Math.max(peakMb, rssInMb());
    }
  }

  // GC pressure settle
  await new Promise((r) => setTimeout(r, 200));
  peakMb = Math.max(peakMb, rssInMb());

  return {
    library: 'vasto-memory',
    scenario: SCENARIO,
    iterations: 1,
    memoryMb: Math.max(0, peakMb - baselineMb),
    meta: { totalRssMb: peakMb, baselineMb, jobCount: JOB_COUNT },
  };
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
// Entry point
// ---------------------------------------------------------------------------

export async function run(opts: ScenarioOptions = {}): Promise<ScenarioReport> {
  const resolved = { ...DEFAULT_OPTIONS, ...opts };
  const results: ScenarioResult[] = [];

  console.log(`\nRunning ${SCENARIO} (${JOB_COUNT.toLocaleString()} queued jobs, no workers)...`);

  results.push(await runVastoMemory());
  console.log(`  vasto-memory done`);

  if (resolved.redisUrl) {
    results.push(await runBullMQ(resolved));
    console.log(`  bullmq done`);

    results.push(await runBeeQueue(resolved));
    console.log(`  bee-queue done`);
  }

  // Footnote
  const report = buildReport(SCENARIO, results);
  printReport(report);
  console.log('> Note: RSS delta for Redis-backed libraries reflects client heap only; job data lives in Redis.\n');
  return report;
}
