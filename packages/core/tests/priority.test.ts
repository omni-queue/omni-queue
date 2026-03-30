import { describe, expect, it, vi } from 'vitest';
import { Job } from '../src/contracts/job';
import type { Plugin } from '../src/interfaces/plugin';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { PooledExecutor } from '../src/libs/pooled-executor';
import { JobManager } from '../src/libs/worker-runtime';
import { JobRegistry } from '../src/libs/registry';
import { priorityScore, PRIORITY_SCORES } from '../src/utils';
import type { JobPriority, StoredJob } from '../src/types';

// ---------------------------------------------------------------------------
// Test job
// ---------------------------------------------------------------------------

class PriorityTestJob extends Job<{ label: string }> {
  static jobName = 'priority-test-job';
  jobName = PriorityTestJob.jobName;

  async handle(payload: { label: string }): Promise<{ label: string }> {
    return { label: payload.label };
  }

  override queue(): string {
    return 'default';
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createContext(plugin?: Plugin) {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(PriorityTestJob);

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 5,
      batchSize: 20,
      ...(plugin ? { plugins: [plugin] } : {}),
    },
  };

  const workers: Record<string, WorkerConfig> = {};
  const manager = new JobManager(queues, workers, registry, { memory: storage });

  return { storage, manager };
}

// ---------------------------------------------------------------------------
// priorityScore utility
// ---------------------------------------------------------------------------

describe('priorityScore utility', () => {
  it('returns correct numeric weights', () => {
    expect(priorityScore('critical')).toBe(0);
    expect(priorityScore('high')).toBe(1);
    expect(priorityScore('normal')).toBe(2);
    expect(priorityScore('low')).toBe(3);
  });

  it('defaults to normal (2) when undefined', () => {
    expect(priorityScore(undefined)).toBe(2);
  });

  it('PRIORITY_SCORES covers all four levels', () => {
    const levels: JobPriority[] = ['critical', 'high', 'normal', 'low'];
    for (const level of levels) {
      expect(typeof PRIORITY_SCORES[level]).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// InMemoryQueueStorage — dequeue priority ordering
// ---------------------------------------------------------------------------

describe('InMemoryQueueStorage priority dequeue', () => {
  it('dequeues critical before high, high before normal, normal before low', async () => {
    const { storage } = createContext();
    const now = Date.now();

    // Enqueue in reverse urgency order so FIFO would give wrong result
    await storage.enqueue({
      id: 'job-low',
      name: 'test',
      payload: {},
      queue: 'default',
      state: 'queued',
      priority: 'low',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    await storage.enqueue({
      id: 'job-high',
      name: 'test',
      payload: {},
      queue: 'default',
      state: 'queued',
      priority: 'high',
      attempts: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    await storage.enqueue({
      id: 'job-critical',
      name: 'test',
      payload: {},
      queue: 'default',
      state: 'queued',
      priority: 'critical',
      attempts: 0,
      createdAt: now + 2,
      updatedAt: now + 2,
    });
    await storage.enqueue({
      id: 'job-normal',
      name: 'test',
      payload: {},
      queue: 'default',
      state: 'queued',
      priority: 'normal',
      attempts: 0,
      createdAt: now + 3,
      updatedAt: now + 3,
    });

    const batch = await storage.dequeue({ queue: 'default', batchSize: 4, leaseMs: 30_000 });
    const ids = batch.map((j) => j.id);

    expect(ids[0]).toBe('job-critical');
    expect(ids[1]).toBe('job-high');
    expect(ids[2]).toBe('job-normal');
    expect(ids[3]).toBe('job-low');
  });

  it('preserves FIFO within the same priority', async () => {
    const { storage } = createContext();
    const now = Date.now();

    for (let i = 0; i < 3; i++) {
      await storage.enqueue({
        id: `high-${i}`,
        name: 'test',
        payload: {},
        queue: 'default',
        state: 'queued',
        priority: 'high',
        attempts: 0,
        createdAt: now + i,
        updatedAt: now + i,
      });
    }

    const batch = await storage.dequeue({ queue: 'default', batchSize: 3, leaseMs: 30_000 });
    expect(batch.map((j) => j.id)).toEqual(['high-0', 'high-1', 'high-2']);
  });

  it('treats jobs with no priority as normal', async () => {
    const { storage } = createContext();
    const now = Date.now();

    await storage.enqueue({
      id: 'no-priority',
      name: 'test',
      payload: {},
      queue: 'default',
      state: 'queued',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    await storage.enqueue({
      id: 'high-priority',
      name: 'test',
      payload: {},
      queue: 'default',
      state: 'queued',
      priority: 'high',
      attempts: 0,
      createdAt: now + 1,
      updatedAt: now + 1,
    });

    const batch = await storage.dequeue({ queue: 'default', batchSize: 2, leaseMs: 30_000 });
    expect(batch[0]!.id).toBe('high-priority');
    expect(batch[1]!.id).toBe('no-priority');
  });
});

// ---------------------------------------------------------------------------
// JobManager — priority stored on dispatched StoredJob
// ---------------------------------------------------------------------------

describe('JobManager.dispatch priority propagation', () => {
  it('stores priority on the StoredJob', async () => {
    const { storage, manager } = createContext();

    await manager.dispatch(new PriorityTestJob({ label: 'urgent' }), {
      priority: 'critical',
    });

    const batch = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
    expect(batch[0]!.priority).toBe('critical');
  });

  it('job with no priority option leaves priority undefined', async () => {
    const { storage, manager } = createContext();

    await manager.dispatch(new PriorityTestJob({ label: 'plain' }));

    const batch = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
    // not set explicitly — storage uses undefined (treated as normal)
    expect(batch[0]!.priority).toBeUndefined();
  });

  it('emits onJobPrioritized plugin hook when priority is set', async () => {
    const onJobPrioritized = vi.fn(async (_job: StoredJob): Promise<void> => undefined);
    const { manager } = createContext({ onJobPrioritized });

    await manager.dispatch(new PriorityTestJob({ label: 'hook-test' }), {
      priority: 'high',
    });

    expect(onJobPrioritized).toHaveBeenCalledOnce();
    const firstCall = onJobPrioritized.mock.calls[0];
    expect(firstCall![0].priority).toBe('high');
  });

  it('does NOT emit onJobPrioritized when no priority is given', async () => {
    const onJobPrioritized = vi.fn(async (_job: StoredJob): Promise<void> => undefined);
    const { manager } = createContext({ onJobPrioritized });

    await manager.dispatch(new PriorityTestJob({ label: 'no-hook' }));

    expect(onJobPrioritized).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PooledExecutor — priority ordering in the waiting queue
// ---------------------------------------------------------------------------

describe('PooledExecutor priority ordering', () => {
  it('runs higher-priority tasks before lower-priority ones when concurrency is full', async () => {
    const executor = new PooledExecutor(1); // only 1 slot at a time
    const order: string[] = [];

    // Fill the slot with a long-running task
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveBlocker = r;
    });

    // Submit the blocking task (no priority = normal=2) — it occupies the slot
    const blockerDone = executor.submit(() => blocker, 2);

    // Submit work while slot is taken; they queue up
    // low priority
    executor.submit(async () => {
      order.push('low');
    }, 3);

    // critical priority — should run first after blocker
    executor.submit(async () => {
      order.push('critical');
    }, 0);

    // high priority — should run second
    executor.submit(async () => {
      order.push('high');
    }, 1);

    // Release the blocker
    resolveBlocker();
    await blockerDone;

    // Give all queued tasks time to run
    await new Promise((r) => setTimeout(r, 20));

    expect(order[0]).toBe('critical');
    expect(order[1]).toBe('high');
    expect(order[2]).toBe('low');
  });

  it('defaults to priority 2 (normal) when no priority given', async () => {
    const executor = new PooledExecutor(1);
    let resolveBlocker!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveBlocker = r;
    });

    const order: string[] = [];

    executor.submit(() => blocker);         // occupies the slot
    executor.submit(async () => { order.push('b'); }); // priority 2
    executor.submit(async () => { order.push('a'); }, 1); // priority 1 — should run first

    resolveBlocker();
    await new Promise((r) => setTimeout(r, 20));

    expect(order[0]).toBe('a');
    expect(order[1]).toBe('b');
  });
});
