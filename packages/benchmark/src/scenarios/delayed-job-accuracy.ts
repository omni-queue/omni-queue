/**
 * Scenario: Delayed Job Accuracy
 *
 * Schedules N jobs with a 500ms delay and measures the drift between the
 * scheduled execution time and the actual execution time (mean drift in ms).
 * Lower is better. Scheduler precision matters for time-sensitive background
 * tasks such as reminders, retries, or SLA deadline checks.
 *
 * Sample size: 50 delayed jobs per library
 * Target delay: 500 ms
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
import { buildReport, DEFAULT_OPTIONS, meanOf, printReport, withTimeout } from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';

const SAMPLE_SIZE = 50;
const DELAY_MS = 500;
const SCENARIO = 'delayed-job-accuracy';
let recordedDrifts: number[] = [];

// ---------------------------------------------------------------------------
// Vasto in-memory
// ---------------------------------------------------------------------------

class DelayedBenchJob extends Job<{ scheduledFor: number }> {
  static jobName = 'bench-delayed';
  override jobName = 'bench-delayed';
  override queue() { return 'bench'; }
  override async handle(payload: { scheduledFor: number }) {
    recordedDrifts.push(Math.max(0, Date.now() - payload.scheduledFor));
  }
}

async function runVastoMemory(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  recordedDrifts = [];

  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(DelayedBenchJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ bench: { name: 'bench', connection: 'memory', concurrency: 10, batchSize: 10 } }),
    workers: defineWorkers({ w: { queues: ['bench'], concurrency: 10 } }),
    registry,
    storageAdapters: { memory: storage },
  });

  await supervisor.start('worker');

  const total = SAMPLE_SIZE + opts.warmupIterations;

  for (let i = 0; i < total; i++) {
    const scheduledFor = Date.now() + DELAY_MS;
    await supervisor.jobManager.dispatch(new DelayedBenchJob({ scheduledFor }), { delayMs: DELAY_MS });
  }

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (recordedDrifts.length >= total) {
        clearInterval(check);
        resolve();
      }
    }, 20);
  });

  supervisor.stop();

  const measured = recordedDrifts.slice(opts.warmupIterations);

  return {
    library: 'vasto-memory',
    scenario: SCENARIO,
    iterations: SAMPLE_SIZE,
    schedulerDriftMs: meanOf(measured.length > 0 ? measured : [0]),
  };
}

// ---------------------------------------------------------------------------
// BullMQ
// ---------------------------------------------------------------------------

async function runBullMQ(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const drifts: number[] = [];

  const queueName = `bench-bullmq-delay-${Date.now()}`;
  const queue = new BullMQQueue(queueName, {
    connection: { url: opts.redisUrl },
  });

  await queue.obliterate({ force: true }).catch(() => {});

  const total = SAMPLE_SIZE + opts.warmupIterations;
  let sampleCount = 0;

  await withTimeout(
    new Promise<void>((resolve) => {
      const worker = new BullMQWorker(
        queueName,
        async (job) => {
          const scheduledFor = job.data.scheduledFor as number;
          const drift = Math.max(0, Date.now() - scheduledFor);
          if (sampleCount >= opts.warmupIterations) drifts.push(drift);
          sampleCount++;
          if (sampleCount >= total) {
            void worker.close().then(resolve);
          }
        },
        { connection: { url: opts.redisUrl }, concurrency: 10 },
      );

      void (async () => {
        await worker.waitUntilReady();
        for (let i = 0; i < total; i++) {
          await queue.add('bench', { scheduledFor: Date.now() + DELAY_MS }, { delay: DELAY_MS });
        }
      })();
    }),
    30000,
    'bullmq delayed round',
  );

  await queue.obliterate({ force: true }).catch(() => {});
  await queue.close();

  return {
    library: 'bullmq',
    scenario: SCENARIO,
    iterations: SAMPLE_SIZE,
    schedulerDriftMs: meanOf(drifts.length > 0 ? drifts : [0]),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(opts: ScenarioOptions = {}): Promise<ScenarioReport> {
  const resolved = { ...DEFAULT_OPTIONS, ...opts };
  const results: ScenarioResult[] = [];

  console.log(`\nRunning ${SCENARIO} (${SAMPLE_SIZE} delayed jobs, target delay ${DELAY_MS}ms)...`);

  results.push(await runVastoMemory(resolved));
  console.log(`  vasto-memory done`);

  if (resolved.redisUrl) {
    results.push(await runBullMQ(resolved));
    console.log(`  bullmq done`);
  }

  const report = buildReport(SCENARIO, results);
  printReport(report);
  return report;
}
