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
const CONCURRENCY_LEVELS = [1, 5, 10, 25];
const SCENARIO = 'concurrency-scaling';

class ConcurrencyJob extends Job<{ index: number }> {
  static jobName = 'bench-concurrency';
  override jobName = 'bench-concurrency';
  override queue() { return 'bench'; }
  override async handle() { /* no-op */ }
}

async function vastoAtConcurrency(
  concurrency: number,
  opts: Required<ScenarioOptions>,
): Promise<number> {
  const durations: number[] = [];

  for (let round = 0; round < opts.warmupIterations + opts.iterations; round++) {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(ConcurrencyJob);

    const supervisor = new Supervisor({
      queues: defineQueues({ bench: { name: 'bench', connection: 'memory', concurrency, batchSize: 10 } }),
      workers: defineWorkers({ w: { queues: ['bench'], concurrency } }),
      registry,
      storageAdapters: { memory: storage },
    });

    for (let i = 0; i < JOBS_PER_ROUND; i++) {
      await supervisor.jobManager.dispatch(new ConcurrencyJob({ index: i }));
    }

    const processed = new Promise<void>((resolve) => {
      let done = 0;
      supervisor.subscribeLifecycleEvents((evt) => {
        if (evt.type === 'job.completed' || evt.type === 'job.failed') {
          if (++done >= JOBS_PER_ROUND) resolve();
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(opts: ScenarioOptions = {}): Promise<ScenarioReport> {
  const resolved = { ...DEFAULT_OPTIONS, ...opts };
  const results: ScenarioResult[] = [];

  console.log(`\nRunning ${SCENARIO} at concurrency levels [${CONCURRENCY_LEVELS.join(', ')}]...`);

  for (const c of CONCURRENCY_LEVELS) {
    const vastoMean = await vastoAtConcurrency(c, resolved);
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
  console.log('| concurrency | vasto-memory ops/sec | bullmq ops/sec |');
  console.log('|------------:|---------------------:|---------------:|');

  for (const c of CONCURRENCY_LEVELS) {
    const vasto = results.find((r) => r.library === 'vasto-memory' && r.meta?.['concurrency'] === c);
    const bull = results.find((r) => r.library === 'bullmq' && r.meta?.['concurrency'] === c);
    console.log(`| ${c} | ${vasto?.ops ?? '-'} | ${bull?.ops ?? '-'} |`);
  }
  console.log('');
  return report;
}
