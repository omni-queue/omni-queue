import { describe, expect, it, vi } from 'vitest';
import { Job } from '../src/contracts/job';
import type { QueueConfig } from '../src/interfaces/queue-config';
import type { WorkerConfig } from '../src/interfaces/worker-config';
import type { Plugin } from '../src/interfaces/plugin';
import { InMemoryQueueStorage } from '../src/libs/in-memory-queue-storage';
import { JobRegistry } from '../src/libs/registry';
import { Supervisor } from '../src/libs/supervisor';

class DagParentJob extends Job<{ ok: boolean }> {
  static jobName = 'dag-plugin-parent-job';
  override jobName = DagParentJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(): Promise<string> {
    return 'done';
  }
}

class DagChildJob extends Job<{ label: string }> {
  static jobName = 'dag-plugin-child-job';
  override jobName = DagChildJob.jobName;

  override queue(): string {
    return 'default';
  }

  override isolation(): 'inline' {
    return 'inline';
  }

  override async handle(): Promise<string> {
    return 'child-done';
  }
}

describe('getDagPlugins — global plugin with registerNode', () => {
  it('calls registerNode on plugins that implement it for each flow node', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(DagParentJob);
    registry.register(DagChildJob);

    const registerNode = vi.fn();

    // A plugin that has registerNode — this makes it a DagPluginLike candidate
    const dagAwarePlugin: Plugin & { registerNode: (node: unknown) => void } = {
      registerNode,
    };

    const queues: Record<string, QueueConfig> = {
      default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 5 },
    };

    const workers: Record<string, WorkerConfig> = {
      worker: { queues: ['default'], concurrency: 1, isolation: 'inline' },
    };

    const supervisor = new Supervisor({
      queues,
      workers,
      registry,
      storageAdapters: { memory: storage },
      globalPlugins: [dagAwarePlugin],
    });

    await supervisor.dispatchFlow([
      { id: 'node-a', job: new DagParentJob({ ok: true }) },
      { id: 'node-b', job: new DagChildJob({ label: 'b' }), dependsOn: ['node-a'] },
    ]);

    // Only root nodes (no dependsOn) get dispatchFlowNode called during dispatchFlow.
    // node-b depends on node-a, so it is only dispatched once node-a completes.
    // registerNode is called once per dispatchFlowNode call → expect exactly 1 call here.
    expect(registerNode).toHaveBeenCalledTimes(1);
    expect(registerNode).toHaveBeenCalledWith(expect.objectContaining({ completed: false }));
  });

  it('does not call registerNode on plugins that lack the method', async () => {
    const storage = new InMemoryQueueStorage();
    const registry = new JobRegistry();
    registry.register(DagParentJob);

    const onProcessEnd = vi.fn(async () => undefined);
    // Regular plugin without registerNode
    const regularPlugin: Plugin = { onProcessEnd };

    const queues: Record<string, QueueConfig> = {
      default: { name: 'default', connection: 'memory', concurrency: 1, batchSize: 5 },
    };

    const workers: Record<string, WorkerConfig> = {
      worker: { queues: ['default'], concurrency: 1, isolation: 'inline' },
    };

    const supervisor = new Supervisor({
      queues,
      workers,
      registry,
      storageAdapters: { memory: storage },
      globalPlugins: [regularPlugin],
    });

    // Should not throw even with a plugin that has no registerNode
    await expect(
      supervisor.dispatchFlow([{ id: 'only-node', job: new DagParentJob({ ok: true }) }])
    ).resolves.toBeDefined();
  });
});
