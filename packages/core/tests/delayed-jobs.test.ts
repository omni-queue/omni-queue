import { afterEach, describe, expect, it, vi } from 'vitest';
import { Job } from '../src/contracts/job';
import type { Plugin } from '../src/interfaces/plugin';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { ScheduledJobPromoter } from '../src/libs/scheduled-job-promoter';
import { JobManager } from '../src/libs/worker-runtime';

const PROMOTER_POLL_INTERVAL_MS = 25;

class DelayedTestJob extends Job<{ value: string }> {
  static jobName = 'delayed-test-job';
  jobName = DelayedTestJob.jobName;

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
  registry.register(DelayedTestJob);

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

  return { storage, registry, queues, workers, manager };
}

describe('Phase 1.1 delayed job flow', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('dispatch stores delay metadata and emits onJobDelayed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const onJobDelayed = vi.fn(async () => undefined);
    const { storage, manager } = createTestContext({ onJobDelayed });

    await manager.dispatch(new DelayedTestJob({ value: 'hello' }), {
      jobId: 'job-delay-1',
      delayMs: 5000,
    });

    const storedJob = storage.getJob('job-delay-1');
    expect(storedJob).toBeDefined();
    expect(storedJob?.delayUntil).toBe(Date.now() + 5000);
    expect(storedJob?.state).toBe('queued');

    expect(onJobDelayed).toHaveBeenCalledTimes(1);
    expect(onJobDelayed).toHaveBeenCalledWith(expect.any(DelayedTestJob), 5000);

    const availableJobs = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 1000 });
    expect(availableJobs).toHaveLength(0);

    const pendingDeferred = await storage.queryDeferredJobs({
      queueName: 'default',
      status: 'pending',
    });
    expect(pendingDeferred).toHaveLength(1);
    expect(pendingDeferred[0]?.id).toBe('job-delay-1');
  });

  it('promoter makes delayed jobs dequeueable and emits onJobPromoted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    const onJobPromoted = vi.fn(async () => undefined);
    const { storage, queues, manager } = createTestContext();

    await manager.dispatch(new DelayedTestJob({ value: 'world' }), {
      jobId: 'job-delay-2',
      delayMs: 100,
    });

    const prePromotion = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 1000 });
    expect(prePromotion).toHaveLength(0);

    const promoter = new ScheduledJobPromoter(
      storage,
      queues,
      PROMOTER_POLL_INTERVAL_MS,
      [{ onJobPromoted }]
    );
    promoter.start();

    await vi.advanceTimersByTimeAsync(PROMOTER_POLL_INTERVAL_MS * 6);

    promoter.stop();

    const promotedJob = storage.getJob('job-delay-2');
    expect(promotedJob).toBeDefined();
    expect(promotedJob?.delayUntil).toBeUndefined();

    expect(onJobPromoted).toHaveBeenCalledTimes(1);
    expect(onJobPromoted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-delay-2', queue: 'default' })
    );

    const postPromotion = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 1000 });
    expect(postPromotion).toHaveLength(1);
    expect(postPromotion[0]?.id).toBe('job-delay-2');
    expect(postPromotion[0]?.state).toBe('leased');

    const pendingDeferred = await storage.queryDeferredJobs({
      queueName: 'default',
      status: 'pending',
    });
    expect(pendingDeferred).toHaveLength(0);
  });
});
