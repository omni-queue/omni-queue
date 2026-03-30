import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { JobRegistry } from '../src/libs/registry';
import { JobManager } from '../src/libs/worker-runtime';

const INTERNAL_REPEATABLE_QUEUE = '__omni_internal_repeatables';

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
});
