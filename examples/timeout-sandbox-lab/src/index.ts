import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@omni-queue/core';

class SlowTimeoutJob extends Job<{ id: string }> {
  static jobName = 'slow-timeout';
  override jobName = SlowTimeoutJob.jobName;

  override queue() {
    return 'timed';
  }

  override async handle(payload: { id: string }) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { ok: true, id: payload.id };
  }
}

class SandboxInlineJob extends Job<{ id: string }> {
  static jobName = 'sandbox-inline-job';
  override jobName = SandboxInlineJob.jobName;

  override queue() {
    return 'sandboxed-inline';
  }

  override async handle(payload: { id: string }) {
    return { shouldNotRun: true, id: payload.id };
  }
}

async function main() {
  const registry = new JobRegistry();
  registry.registerAll([SlowTimeoutJob, SandboxInlineJob]);

  const supervisor = new Supervisor({
    queues: defineQueues({
      timed: {
        name: 'timed',
        connection: 'memory',
        concurrency: 1,
        batchSize: 5,
        executionTimeoutMs: 100,
        timeoutStrategy: 'fail',
        maxAttempts: 1,
      },
      'sandboxed-inline': {
        name: 'sandboxed-inline',
        connection: 'memory',
        concurrency: 1,
        batchSize: 5,
        sandbox: {
          enabled: true,
          denyNetwork: true,
          denyChildProcessSpawn: true,
          readOnlyFilesystem: true,
        },
        maxAttempts: 1,
      },
    }),
    workers: defineWorkers({
      main: { queues: ['timed', 'sandboxed-inline'], concurrency: 1, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { memory: new InMemoryQueueStorage() },
  });

  await supervisor.start();

  await supervisor.jobManager.dispatch(new SlowTimeoutJob({ id: 't-001' }));
  await supervisor.jobManager.dispatch(new SandboxInlineJob({ id: 's-001' }));

  await new Promise((resolve) => setTimeout(resolve, 700));

  const timedDlq = await supervisor.getDLQ({ queueName: 'timed', limit: 10 });
  const sandboxDlq = await supervisor.getDLQ({ queueName: 'sandboxed-inline', limit: 10 });

  console.log(
    'timed queue DLQ:',
    timedDlq.map((job) => ({ id: job.id, error: (job as { error?: string }).error ?? 'n/a' }))
  );
  console.log(
    'sandboxed-inline queue DLQ:',
    sandboxDlq.map((job) => ({ id: job.id, error: (job as { error?: string }).error ?? 'n/a' }))
  );

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
