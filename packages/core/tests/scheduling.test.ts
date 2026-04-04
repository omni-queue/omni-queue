import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cronScheduleMock = vi.hoisted(() => vi.fn());

vi.mock('node-cron', () => ({
  default: {
    schedule: cronScheduleMock,
  },
}));

import { Job } from '../src/contracts/job';
import type { Plugin } from '../src/interfaces/plugin';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { FileQueueStorage } from '../src/libs/file-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';
import { Supervisor } from '../src/libs/supervisor';

const INTERNAL_REPEATABLE_QUEUE = '__vasto_internal_repeatables';

class ScheduledTestJob extends Job<{ value: string }> {
  static jobName = 'scheduled-test-job';
  jobName = ScheduledTestJob.jobName;

  async handle(payload: { value: string }): Promise<{ ok: boolean; value: string }> {
    return { ok: true, value: payload.value };
  }

  override queue(): string {
    return 'default';
  }
}

function createTestContext(plugin?: Plugin) {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(ScheduledTestJob);

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 1,
      batchSize: 10,
      ...(plugin ? { plugins: [plugin] } : {}),
    },
  };

  const workers: Record<string, WorkerConfig> = {};
  const manager = new JobManager(queues, workers, registry, { memory: storage });

  return { storage, manager };
}

describe('JobManager.schedule', () => {
  beforeEach(() => {
    cronScheduleMock.mockReset();
    cronScheduleMock.mockImplementation(() => ({
      stop: vi.fn(),
      destroy: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('materializes runAt schedules as delayed jobs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const onScheduleCreated = vi.fn(async () => undefined);
    const { storage, manager } = createTestContext({ onScheduleCreated });

    const runAt = Date.now() + 5000;
    const handle = await manager.schedule(new ScheduledTestJob({ value: 'once' }), { runAt });

    expect(handle.id).toBeTruthy();
    expect(onScheduleCreated).toHaveBeenCalledWith(ScheduledTestJob.jobName, `at:${runAt}`);

    const deferred = await storage.queryDeferredJobs({ queueName: 'default', status: 'pending' });
    expect(deferred).toHaveLength(1);
    expect(deferred[0]?.delayUntil).toBe(runAt);
    expect(deferred[0]?.lastScheduledAt).toBe(runAt);

    const available = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 1000 });
    expect(available).toHaveLength(0);
  });

  it('dispatches recurring interval schedules until stopped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const onScheduleCreated = vi.fn(async () => undefined);
    const { storage, manager } = createTestContext({ onScheduleCreated });

    const handle = await manager.schedule(new ScheduledTestJob({ value: 'repeat' }), {
      intervalMs: 100,
    });

    expect(onScheduleCreated).toHaveBeenCalledWith(ScheduledTestJob.jobName, 'every:100ms');

    await vi.advanceTimersByTimeAsync(250);
    expect(await storage.getQueueDepth('default')).toBe(2);

    handle.stop();
    await vi.advanceTimersByTimeAsync(300);
    expect(await storage.getQueueDepth('default')).toBe(2);
  });

  it('registers cron schedules and dispatches jobs on cron ticks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const onScheduleCreated = vi.fn(async () => undefined);
    const cronTask = {
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    cronScheduleMock.mockReturnValue(cronTask);

    const { storage, manager } = createTestContext({ onScheduleCreated });

    const handle = await manager.schedule(new ScheduledTestJob({ value: 'cron' }), {
      pattern: '*/5 * * * * *',
      timezone: 'UTC',
    });

    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    const [pattern, callback, config] = cronScheduleMock.mock.calls[0] ?? [];
    expect(pattern).toBe('*/5 * * * * *');
    expect(config).toEqual({ timezone: 'UTC' });
    expect(onScheduleCreated).toHaveBeenCalledWith(
      ScheduledTestJob.jobName,
      '*/5 * * * * *'
    );

    await callback();
    await Promise.resolve();
    await Promise.resolve();

    const jobs = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 1000 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.scheduledCron).toBe('*/5 * * * * *');
    expect(jobs[0]?.lastScheduledAt).toBe(Date.now());

    handle.stop();
    expect(cronTask.stop).toHaveBeenCalledTimes(1);
    expect(cronTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('persists durable repeatable schedules and removes them on stop', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const { storage, manager } = createTestContext();

    const handle = await manager.schedule(new ScheduledTestJob({ value: 'durable-repeat' }), {
      intervalMs: 100,
      durable: true,
    });

    const persistedBeforeStop = await storage.getReadyJobs({
      queueName: INTERNAL_REPEATABLE_QUEUE,
      limit: 100,
      offset: 0,
    });
    expect(persistedBeforeStop).toHaveLength(1);

    handle.stop();

    const persistedAfterStop = await storage.getReadyJobs({
      queueName: INTERNAL_REPEATABLE_QUEUE,
      limit: 100,
      offset: 0,
    });
    expect(persistedAfterStop).toHaveLength(0);
  });

  it('recovers durable repeatable schedules after restart', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(ScheduledTestJob);

    const queues: Record<string, QueueConfig> = {
      default: {
        name: 'default',
        connection: 'memory',
        concurrency: 1,
        batchSize: 10,
      },
    };

    const workers: Record<string, WorkerConfig> = {};
    const managerA = new JobManager(queues, workers, registry, { memory: storage });

    await managerA.schedule(new ScheduledTestJob({ value: 'recover-me' }), {
      intervalMs: 100,
      durable: true,
    });

    const managerB = new JobManager(queues, workers, registry, { memory: storage });
    const recovered = await managerB.recoverRepeatableSchedules();
    expect(recovered).toBe(1);

    managerA.stopSchedules();

    await vi.advanceTimersByTimeAsync(250);
    expect(await storage.getQueueDepth('default')).toBe(2);

    managerB.stopSchedules();
  });

  it('prunes persisted repeatables when the job is no longer registered', async () => {
    const storage = new InMemoryQueueStorage();

    const registryA = new JobRegistry();
    registryA.register(ScheduledTestJob);

    const queues: Record<string, QueueConfig> = {
      default: {
        name: 'default',
        connection: 'memory',
        concurrency: 1,
        batchSize: 10,
      },
    };

    const workers: Record<string, WorkerConfig> = {};
    const managerA = new JobManager(queues, workers, registryA, { memory: storage });

    await managerA.schedule(new ScheduledTestJob({ value: 'stale-repeatable' }), {
      intervalMs: 100,
      durable: true,
    });

    const persistedBefore = await storage.getReadyJobs({
      queueName: INTERNAL_REPEATABLE_QUEUE,
      limit: 100,
      offset: 0,
    });
    expect(persistedBefore).toHaveLength(1);

    const registryB = new JobRegistry();
    const managerB = new JobManager(queues, workers, registryB, { memory: storage });

    const recovered = await managerB.recoverRepeatableSchedules();
    expect(recovered).toBe(0);

    const persistedAfter = await storage.getReadyJobs({
      queueName: INTERNAL_REPEATABLE_QUEUE,
      limit: 100,
      offset: 0,
    });
    expect(persistedAfter).toHaveLength(0);
  });

  it('does not recover persisted repeatables when supervisor recovery is disabled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(ScheduledTestJob);

    const queues: Record<string, QueueConfig> = {
      default: {
        name: 'default',
        connection: 'memory',
        concurrency: 1,
        batchSize: 10,
      },
    };

    const now = Date.now();
    const scheduleId = 'persisted-no-recover';
    await storage.enqueue({
      id: `repeatable:${scheduleId}`,
      name: '__vasto_repeatable_schedule__',
      payload: {
        type: 'repeatable-schedule',
        definition: {
          id: scheduleId,
          queue: 'default',
          jobName: ScheduledTestJob.jobName,
          payload: { value: 'no-recover' },
          intervalMs: 100,
          createdAt: now,
          updatedAt: now,
        },
      },
      queue: INTERNAL_REPEATABLE_QUEUE,
      attempts: 0,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
      idempotencyKey: `repeatable:${scheduleId}`,
    });

    const supervisor = new Supervisor({
      queues,
      workers: {},
      registry,
      storageAdapters: { memory: storage },
      repeatables: { recoverOnStart: false },
    });

    await supervisor.start('api');
    await vi.advanceTimersByTimeAsync(250);

    expect(await storage.getQueueDepth('default')).toBe(0);

    supervisor.stop();
  });

  it('lists and removes repeatable schedules', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const { manager } = createTestContext();

    await manager.schedule(new ScheduledTestJob({ value: 'interval' }), {
      intervalMs: 100,
      durable: true,
    });
    await manager.schedule(new ScheduledTestJob({ value: 'cron' }), {
      pattern: '*/5 * * * * *',
      durable: true,
    });

    const listed = await manager.listRepeatableSchedules();
    expect(listed).toHaveLength(2);

    const removed = await manager.removeRepeatableSchedule(listed[0]!.id);
    expect(removed).toBe(true);

    const afterRemoval = await manager.listRepeatableSchedules();
    expect(afterRemoval).toHaveLength(1);

    const cleared = await manager.clearRepeatableSchedules();
    expect(cleared).toBe(1);

    const afterClear = await manager.listRepeatableSchedules();
    expect(afterClear).toHaveLength(0);
  });

  it('clears repeatable schedules by queue via supervisor', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(ScheduledTestJob);

    class OtherScheduledJob extends Job<{ value: string }> {
      static jobName = 'other-scheduled-job';
      jobName = OtherScheduledJob.jobName;

      async handle(payload: { value: string }): Promise<{ ok: boolean; value: string }> {
        return { ok: true, value: payload.value };
      }

      override queue(): string {
        return 'other';
      }
    }

    registry.register(OtherScheduledJob);

    const queues: Record<string, QueueConfig> = {
      default: {
        name: 'default',
        connection: 'memory',
        concurrency: 1,
        batchSize: 10,
      },
      other: {
        name: 'other',
        connection: 'memory',
        concurrency: 1,
        batchSize: 10,
      },
    };

    const supervisor = new Supervisor({
      queues,
      workers: {},
      registry,
      storageAdapters: { memory: storage },
      repeatables: { recoverOnStart: false },
    });

    await supervisor.jobManager.schedule(new ScheduledTestJob({ value: 'default' }), {
      intervalMs: 100,
      durable: true,
    });
    await supervisor.jobManager.schedule(new OtherScheduledJob({ value: 'other' }), {
      intervalMs: 100,
      durable: true,
    });

    const before = await supervisor.listRepeatableSchedules();
    expect(before).toHaveLength(2);

    const removed = await supervisor.clearRepeatableSchedules({ queueName: 'default' });
    expect(removed).toBe(1);

    const after = await supervisor.listRepeatableSchedules();
    expect(after).toHaveLength(1);
    expect(after[0]?.queue).toBe('other');
  });

  it('removes persisted repeatable schedule records from file storage queued state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasto-repeatable-'));

    try {
      const storage = new FileQueueStorage(tmpDir);
      const registry = new JobRegistry();
      registry.register(ScheduledTestJob);

      const supervisor = new Supervisor({
        queues: {
          default: {
            name: 'default',
            connection: 'file',
            concurrency: 1,
            batchSize: 10,
          },
        },
        workers: {},
        registry,
        storageAdapters: { file: storage },
        repeatables: { recoverOnStart: false },
      });

      await supervisor.jobManager.schedule(new ScheduledTestJob({ value: 'file-repeatable' }), {
        intervalMs: 1_000,
        durable: true,
      });

      const before = await supervisor.listRepeatableSchedules();
      expect(before).toHaveLength(1);

      const removed = await supervisor.removeRepeatableSchedule(before[0]!.id);
      expect(removed).toBe(true);

      const queuedDir = path.join(tmpDir, 'queued');
      const queuedFiles = fs.existsSync(queuedDir)
        ? fs.readdirSync(queuedDir).filter((name) => name.endsWith('.json'))
        : [];
      expect(queuedFiles.some((name) => name.startsWith('repeatable:'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
