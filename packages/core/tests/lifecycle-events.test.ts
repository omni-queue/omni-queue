import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { Supervisor } from '../src/libs/supervisor';
import type { QueueLifecycleEvent } from '../src/libs/lifecycle-events';

class LifecycleJob extends Job<{ value: number }> {
  static jobName = 'lifecycle-job';
  override jobName = LifecycleJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { value: number }): Promise<number> {
    return payload.value + 1;
  }
}

describe('Lifecycle event stream contract', () => {
  it('emits queue and job lifecycle events with replay', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(LifecycleJob);

    const supervisor = new Supervisor(
      {
        default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 10 },
      },
      {
        worker: {
          queues: ['default'],
          concurrency: 1,
          isolation: 'inline',
        },
      },
      registry,
      { memory: storage }
    );

    const events: QueueLifecycleEvent[] = [];
    const unsubscribe = supervisor.subscribeLifecycleEvents((event) => {
      events.push(event);
    });

    supervisor.pauseQueue('default');
    supervisor.resumeQueue('default');

    const jobId = await supervisor.jobManager.dispatch(new LifecycleJob({ value: 1 }), { jobId: 'life-1' });
    const [leased] = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
    expect(leased?.id).toBe(jobId);
    await supervisor.jobManager.execute(leased!);

    await supervisor.jobManager.dispatch(new LifecycleJob({ value: 2 }), {
      jobId: 'life-deferred',
      delayMs: 60_000,
    });
    await supervisor.promoteJob('default', 'life-deferred');

    unsubscribe();

    const replay = supervisor.getRecentLifecycleEvents(200);

    expect(events.some((event) => event.type === 'queue.paused' && event.queueName === 'default')).toBe(true);
    expect(events.some((event) => event.type === 'queue.resumed' && event.queueName === 'default')).toBe(true);
    expect(events.some((event) => event.type === 'job.enqueued' && event.jobId === 'life-1')).toBe(true);
    expect(events.some((event) => event.type === 'job.started' && event.jobId === 'life-1')).toBe(true);
    expect(events.some((event) => event.type === 'job.completed' && event.jobId === 'life-1')).toBe(true);
    expect(events.some((event) => event.type === 'job.promoted' && event.jobId === 'life-deferred')).toBe(true);

    expect(replay.length).toBeGreaterThan(0);
    expect(replay.at(-1)).toHaveProperty('id');
    expect(replay.at(-1)).toHaveProperty('timestamp');
  });
});
