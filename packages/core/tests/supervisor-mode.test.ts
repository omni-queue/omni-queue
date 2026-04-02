import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import type { QueueLifecycleEvent } from '../src/libs/lifecycle-events';
import { JobRegistry } from '../src/libs/registry';
import { Supervisor } from '../src/libs/supervisor';

class SupervisorModeJob extends Job<{ value: string }> {
  static jobName = 'supervisor-mode-job';
  override jobName = SupervisorModeJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { value: string }): Promise<string> {
    return payload.value;
  }
}

function createSupervisor() {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(SupervisorModeJob);

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 1,
      batchSize: 5,
    },
  };

  const workers: Record<string, WorkerConfig> = {
    worker: {
      queues: ['default'],
      concurrency: 1,
      isolation: 'inline',
    },
  };

  const supervisor = new Supervisor({
    queues,
    workers,
    registry,
    storageAdapters: { memory: storage },
  });

  return { storage, supervisor };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 500, intervalMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('supervisor start modes', () => {
  it('api mode does not start workers or process jobs', async () => {
    const { supervisor } = createSupervisor();
    const events: QueueLifecycleEvent[] = [];
    const unsubscribe = supervisor.subscribeLifecycleEvents((event) => {
      events.push(event);
    });

    try {
      await supervisor.start('api');
      await supervisor.jobManager.dispatch(new SupervisorModeJob({ value: 'api-only' }), {
        jobId: 'mode-api-1',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const readyJobs = await supervisor.getReadyJobs({ queueName: 'default' });
      const completedJobs = await supervisor.getCompletedJobs({ queueName: 'default' });

      expect(events.some((event) => event.type === 'worker.started')).toBe(false);
      expect(readyJobs.map((job) => job.id)).toContain('mode-api-1');
      expect(completedJobs).toEqual([]);
    } finally {
      unsubscribe();
      supervisor.stop();
    }
  });

  it('hybrid mode starts workers and processes jobs in the same process', async () => {
    const { supervisor } = createSupervisor();
    const events: QueueLifecycleEvent[] = [];
    const unsubscribe = supervisor.subscribeLifecycleEvents((event) => {
      events.push(event);
    });

    try {
      await supervisor.start('hybrid');
      await supervisor.jobManager.dispatch(new SupervisorModeJob({ value: 'same-process' }), {
        jobId: 'mode-hybrid-1',
      });

      await waitFor(async () => {
        const completedJobs = await supervisor.getCompletedJobs({ queueName: 'default' });
        return completedJobs.some((job) => job.id === 'mode-hybrid-1');
      });

      const completedJobs = await supervisor.getCompletedJobs({ queueName: 'default' });

      expect(events.some((event) => event.type === 'worker.started' && event.workerName === 'worker')).toBe(true);
      expect(completedJobs.some((job) => job.id === 'mode-hybrid-1')).toBe(true);
    } finally {
      unsubscribe();
      supervisor.stop();
    }
  });
});