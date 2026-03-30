import { describe, expect, it } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { Supervisor } from '../src/libs/supervisor';

class FlowParentJob extends Job<{ ok?: boolean }> {
  static jobName = 'flow-parent-job';
  override jobName = FlowParentJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { ok?: boolean }): Promise<string> {
    if (payload.ok === false) {
      throw new Error('parent failed');
    }
    return 'parent-ok';
  }
}

class FlowChildJob extends Job<{ label: string }> {
  static jobName = 'flow-child-job';
  override jobName = FlowChildJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(payload: { label: string }): Promise<string> {
    return payload.label;
  }
}

function setup() {
  const storage = new InMemoryQueueStorage();
  const registry = new JobRegistry();
  registry.register(FlowParentJob);
  registry.register(FlowChildJob);

  const queues: Record<string, QueueConfig> = {
    default: {
      name: 'default',
      connection: 'memory',
      concurrency: 1,
      batchSize: 5,
      maxAttempts: 1,
    },
  };

  const workers: Record<string, WorkerConfig> = {
    worker: {
      queues: ['default'],
      concurrency: 1,
      isolation: 'inline',
    },
  };

  const storageAdapters = { memory: storage };
  const supervisor = new Supervisor({ queues, workers, registry, storageAdapters });

  return { storage, supervisor };
}

describe('job flows (DAG)', () => {
  it('queues dependent nodes only after dependencies complete', async () => {
    const { storage, supervisor } = setup();

    const flow = await supervisor.dispatchFlow([
      { id: 'parent', job: new FlowParentJob({ ok: true }) },
      { id: 'child', job: new FlowChildJob({ label: 'child' }), dependsOn: ['parent'] },
    ]);

    const initialReady = await storage.getReadyJobs({ queueName: 'default' });
    expect(initialReady).toHaveLength(1);
    expect(initialReady[0]!.name).toBe(FlowParentJob.jobName);

    const leasedParent = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
    await expect(supervisor.jobManager.execute(leasedParent[0]!)).resolves.toBe('parent-ok');

    const afterParentReady = await storage.getReadyJobs({ queueName: 'default' });
    expect(afterParentReady).toHaveLength(1);
    expect(afterParentReady[0]!.name).toBe(FlowChildJob.jobName);

    const latest = supervisor.getFlow(flow.id);
    const parentNode = latest?.nodes.find((node) => node.id === 'parent');
    const childNode = latest?.nodes.find((node) => node.id === 'child');

    expect(parentNode?.status).toBe('completed');
    expect(childNode?.status).toBe('queued');
  });

  it('blocks descendants atomically when a dependency fails permanently', async () => {
    const { storage, supervisor } = setup();

    const flow = await supervisor.dispatchFlow([
      { id: 'parent', job: new FlowParentJob({ ok: false }) },
      { id: 'child', job: new FlowChildJob({ label: 'child' }), dependsOn: ['parent'] },
    ]);

    const leasedParent = await storage.dequeue({ queue: 'default', batchSize: 1, leaseMs: 30_000 });
    await expect(supervisor.jobManager.execute(leasedParent[0]!)).rejects.toThrow('parent failed');

    const ready = await storage.getReadyJobs({ queueName: 'default' });
    expect(ready).toHaveLength(0);

    const latest = supervisor.getFlow(flow.id);
    const parentNode = latest?.nodes.find((node) => node.id === 'parent');
    const childNode = latest?.nodes.find((node) => node.id === 'child');

    expect(parentNode?.status).toBe('failed');
    expect(childNode?.status).toBe('blocked');
  });
});
