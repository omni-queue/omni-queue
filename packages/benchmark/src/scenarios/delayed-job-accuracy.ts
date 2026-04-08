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
import BeeQueue from 'bee-queue';
import PgBoss from 'pg-boss';
import { Job, type Plugin } from '@vasto-queue/core';
import { buildReport, DEFAULT_OPTIONS, meanOf, printReport, withTimeout } from '../harness.js';
import type { ScenarioOptions, ScenarioReport, ScenarioResult } from '../types.js';
import { createVastoFixture } from '../vasto-fixture.js';

const DELAY_MS = 500;
const SCENARIO = 'delayed-job-accuracy';
const DELAYED_PROMOTER_INTERVAL_MS = 10;
let recordedDrifts: number[] = [];

interface DelayedProbePayload {
  scheduledFor: number;
  probeId: string;
}

interface DelayedProbeTimeline {
  library: string;
  backend: 'memory' | 'redis' | 'postgres';
  probeId: string;
  dueAt: number;
  promotedAt?: number;
  processStartAt?: number;
  handledAt?: number;
  driftMs: number;
}

const delayedProbeTimelines = new Map<string, DelayedProbeTimeline>();

function nowMs(): number {
  return Date.now();
}

function recordProbeHandled(payload: DelayedProbePayload): void {
  const handledAt = nowMs();
  const driftMs = Math.max(0, handledAt - payload.scheduledFor);

  const existing = delayedProbeTimelines.get(payload.probeId);
  if (existing) {
    existing.handledAt = handledAt;
    existing.driftMs = driftMs;
    return;
  }

  delayedProbeTimelines.set(payload.probeId, {
    library: 'unknown',
    backend: 'memory',
    probeId: payload.probeId,
    dueAt: payload.scheduledFor,
    handledAt,
    driftMs,
  });
}

function toProbePayload(payload: unknown): DelayedProbePayload | undefined {
  const asObject = (value: unknown): Record<string, unknown> | undefined => {
    if (value == null) {
      return undefined;
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed != null && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return undefined;
      }
      return undefined;
    }

    if (typeof value === 'object') {
      return value as Record<string, unknown>;
    }

    return undefined;
  };

  const base = asObject(payload);
  if (!base) {
    return undefined;
  }

  const nested = asObject(base.payload);
  const candidate = (nested ?? base) as Partial<DelayedProbePayload>;
  if (typeof candidate.scheduledFor !== 'number' || typeof candidate.probeId !== 'string') {
    return undefined;
  }

  return {
    scheduledFor: candidate.scheduledFor,
    probeId: candidate.probeId,
  };
}

function printDelayedDiagnostics(
  library: string,
  backend: 'memory' | 'redis' | 'postgres',
  warmupCount: number,
): void {
  const rows = Array.from(delayedProbeTimelines.values())
    .filter((row) => row.library === library && row.backend === backend)
    .sort((a, b) => b.driftMs - a.driftMs);

  if (rows.length === 0) {
    return;
  }

  const measured = rows.slice(Math.max(0, warmupCount));
  const outliers = measured.slice(0, 5).map((row) => {
    const promotionLagMs = row.promotedAt != null ? Math.max(0, row.promotedAt - row.dueAt) : undefined;
    const pickupLagMs = row.processStartAt != null && row.promotedAt != null
      ? Math.max(0, row.processStartAt - row.promotedAt)
      : undefined;
    const handleLagMs = row.handledAt != null && row.processStartAt != null
      ? Math.max(0, row.handledAt - row.processStartAt)
      : undefined;

    return {
      probeId: row.probeId,
      driftMs: row.driftMs,
      promotionLagMs,
      pickupLagMs,
      handleLagMs,
    };
  });

  const promotionLagValues = measured
    .map((row) => (row.promotedAt != null ? Math.max(0, row.promotedAt - row.dueAt) : undefined))
    .filter((value): value is number => typeof value === 'number');
  const pickupLagValues = measured
    .map((row) =>
      row.processStartAt != null && row.promotedAt != null
        ? Math.max(0, row.processStartAt - row.promotedAt)
        : undefined,
    )
    .filter((value): value is number => typeof value === 'number');

  const avg = (values: number[]): number => {
    if (values.length === 0) {
      return 0;
    }
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
  };

  console.log(
    `[diag][${library}] delayed pipeline means: ` +
      `promotion=${avg(promotionLagValues)}ms, ` +
      `pickup=${avg(pickupLagValues)}ms`,
  );
  console.log(`[diag][${library}] delayed top outliers: ${JSON.stringify(outliers)}`);
}

function createDelayedProbePlugin(
  library: string,
  backend: 'memory' | 'redis' | 'postgres',
  promotedAtByJobId: Map<string, number>,
): Plugin {
  return {
    name: `bench-delayed-probe-${library}`,
    async onProcessStart(job) {
      const payload = toProbePayload(job.payload);
      if (!payload) {
        return;
      }

      const promotedAt = promotedAtByJobId.get(job.id);

      const existing = delayedProbeTimelines.get(payload.probeId);
      if (existing) {
        existing.processStartAt = nowMs();
        if (promotedAt != null) {
          existing.promotedAt = promotedAt;
        }
        if (existing.library === 'unknown') {
          existing.library = library;
          existing.backend = backend;
        }
        return;
      }

      delayedProbeTimelines.set(payload.probeId, {
        library,
        backend,
        probeId: payload.probeId,
        dueAt: payload.scheduledFor,
        ...(promotedAt != null ? { promotedAt } : {}),
        processStartAt: nowMs(),
        driftMs: 0,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Vasto in-memory
// ---------------------------------------------------------------------------

class DelayedBenchJob extends Job<DelayedProbePayload> {
  static jobName = 'bench-delayed';
  override jobName = 'bench-delayed';
  override queue() { return 'bench'; }
  override async handle(payload: DelayedProbePayload) {
    recordProbeHandled(payload);
    recordedDrifts.push(Math.max(0, Date.now() - payload.scheduledFor));
  }
}

async function runVasto(
  backend: 'memory' | 'redis' | 'postgres',
  opts: Required<ScenarioOptions>,
): Promise<ScenarioResult> {
  recordedDrifts = [];
  delayedProbeTimelines.clear();
  const sampleSize = Math.max(1, opts.iterations);
  const promotedAtByJobId = new Map<string, number>();

  const library = backend === 'memory'
    ? 'vasto-memory'
    : backend === 'redis'
      ? 'vasto-redis'
      : 'vasto-postgres';
  const delayedProbePlugin = createDelayedProbePlugin(library, backend, promotedAtByJobId);

  const fixture = await createVastoFixture({
    backend,
    jobClass: DelayedBenchJob,
    concurrency: 10,
    batchSize: 10,
    globalPlugins: [delayedProbePlugin],
    enablePromoter: true,
    redisUrl: opts.redisUrl,
    postgresUrl: opts.postgresUrl,
    promoterIntervalMs: DELAYED_PROMOTER_INTERVAL_MS,
  });

  let unsubscribeLifecycle: (() => void) | undefined;

  try {
    unsubscribeLifecycle = fixture.supervisor.subscribeLifecycleEvents((event) => {
      if (event.type !== 'job.promoted' || !event.jobId) {
        return;
      }
      promotedAtByJobId.set(event.jobId, event.timestamp);
    });

    await fixture.supervisor.start('worker');

    const total = sampleSize + opts.warmupIterations;

    for (let i = 0; i < total; i++) {
      const scheduledFor = Date.now() + DELAY_MS;
      await fixture.supervisor.jobManager.dispatch(
        new DelayedBenchJob({ scheduledFor, probeId: `${backend}-${i}-${scheduledFor}` }),
        { delayMs: DELAY_MS },
      );
    }

    await withTimeout(new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (recordedDrifts.length >= total) {
          clearInterval(check);
          resolve();
        }
      }, 20);
    }), Math.max(30000, total * DELAY_MS * 4), `vasto ${backend} delayed round`);

    const measured = recordedDrifts.slice(opts.warmupIterations);
    printDelayedDiagnostics(fixture.library, backend, opts.warmupIterations);

    return {
      library: fixture.library,
      scenario: SCENARIO,
      iterations: sampleSize,
      schedulerDriftMs: meanOf(measured.length > 0 ? measured : [0]),
    };
  } finally {
    unsubscribeLifecycle?.();
    await fixture.cleanup();
  }
}

// ---------------------------------------------------------------------------
// BullMQ
// ---------------------------------------------------------------------------

async function runBullMQ(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const drifts: number[] = [];
  const sampleSize = Math.max(1, opts.iterations);

  const queueName = `bench-bullmq-delay-${Date.now()}`;
  const queue = new BullMQQueue(queueName, {
    connection: { url: opts.redisUrl },
  });

  await queue.obliterate({ force: true }).catch(() => {});

  const total = sampleSize + opts.warmupIterations;
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
    iterations: sampleSize,
    schedulerDriftMs: meanOf(drifts.length > 0 ? drifts : [0]),
  };
}

// ---------------------------------------------------------------------------
// bee-queue
// ---------------------------------------------------------------------------

async function runBeeQueue(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const drifts: number[] = [];
  const sampleSize = Math.max(1, opts.iterations);
  const queueName = `bench-bee-delay-${Date.now()}`;

  const producerQ = new BeeQueue(queueName, {
    redis: { url: opts.redisUrl },
    isWorker: false,
    getEvents: false,
    activateDelayedJobs: true,
  });

  const workerQ = new BeeQueue(queueName, {
    redis: { url: opts.redisUrl },
    isWorker: true,
    getEvents: true,
    activateDelayedJobs: true,
  });

  await producerQ.ready();
  await workerQ.ready();

  const total = sampleSize + opts.warmupIterations;
  let sampleCount = 0;

  await withTimeout(
    new Promise<void>((resolve) => {
      workerQ.process(10, async (job: BeeQueue.Job<{ scheduledFor: number }>) => {
        const drift = Math.max(0, Date.now() - job.data.scheduledFor);
        if (sampleCount >= opts.warmupIterations) {
          drifts.push(drift);
        }
        sampleCount++;
        if (sampleCount >= total) {
          resolve();
        }
      });

      (async () => {
        for (let i = 0; i < total; i++) {
          const scheduledFor = Date.now() + DELAY_MS;
          const delayed = producerQ.createJob({ scheduledFor }).delayUntil(scheduledFor);
          await delayed.save();
        }
      })();
    }),
    60000,
    'bee-queue delayed round',
  );

  await workerQ.destroy().catch(() => {});
  await producerQ.destroy().catch(() => {});
  await workerQ.close(0).catch(() => {});
  await producerQ.close(0).catch(() => {});

  return {
    library: 'bee-queue',
    scenario: SCENARIO,
    iterations: sampleSize,
    schedulerDriftMs: meanOf(drifts.length > 0 ? drifts : [0]),
  };
}

// ---------------------------------------------------------------------------
// pg-boss
// ---------------------------------------------------------------------------

async function runPgBoss(opts: Required<ScenarioOptions>): Promise<ScenarioResult> {
  const drifts: number[] = [];
  const sampleSize = Math.max(1, opts.iterations);
  const queueName = `bench-pgboss-delay-${Date.now()}`;
  const boss = new PgBoss(opts.postgresUrl);

  await boss.start();
  await boss.deleteQueue(queueName).catch(() => {});
  await boss.createQueue(queueName).catch(() => {});

  const total = sampleSize + opts.warmupIterations;
  let sampleCount = 0;

  await withTimeout(
    new Promise<void>(async (resolve) => {
      await boss.work(
        queueName,
        {
          batchSize: 50,
          pollingIntervalSeconds: 0.5,
        },
        async (jobs: Array<{ data?: { scheduledFor?: number } }>) => {
          for (const job of jobs) {
            const scheduledFor = job.data?.scheduledFor;
            if (typeof scheduledFor !== 'number') {
              continue;
            }

            const drift = Math.max(0, Date.now() - scheduledFor);
            if (sampleCount >= opts.warmupIterations) {
              drifts.push(drift);
            }
            sampleCount += 1;

            if (sampleCount >= total) {
              resolve();
              return;
            }
          }
        },
      );

      const batch = Array.from({ length: total }, () => {
        const scheduledFor = Date.now() + DELAY_MS;
        return {
          name: queueName,
          data: { scheduledFor },
          startAfter: new Date(scheduledFor).toISOString(),
        };
      });

      await boss.insert(batch);
    }),
    60000,
    'pg-boss delayed round',
  );

  await boss.offWork(queueName).catch(() => {});
  await boss.deleteQueue(queueName).catch(() => {});
  await boss.stop();

  return {
    library: 'pg-boss',
    scenario: SCENARIO,
    iterations: sampleSize,
    schedulerDriftMs: meanOf(drifts.length > 0 ? drifts : [0]),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(opts: ScenarioOptions = {}): Promise<ScenarioReport> {
  const resolved = { ...DEFAULT_OPTIONS, ...opts };
  const sampleSize = Math.max(1, resolved.iterations);
  const results: ScenarioResult[] = [];

  console.log(`\nRunning ${SCENARIO} (${sampleSize} delayed jobs, target delay ${DELAY_MS}ms)...`);

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
