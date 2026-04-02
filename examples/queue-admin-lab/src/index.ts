import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@omni-queue/core';

class FastJob extends Job<{ id: string }> {
  static jobName = 'fast-job';
  override jobName = FastJob.jobName;

  override queue() {
    return 'ops';
  }

  override async handle(payload: { id: string }) {
    return { ok: true, id: payload.id };
  }
}

class SlowJob extends Job<{ id: string }> {
  static jobName = 'slow-job';
  override jobName = SlowJob.jobName;

  override queue() {
    return 'ops';
  }

  override async handle(payload: { id: string }) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { ok: true, id: payload.id };
  }
}

async function main() {
  const registry = new JobRegistry();
  registry.registerAll([FastJob, SlowJob]);

  const supervisor = new Supervisor({
    queues: defineQueues({
      ops: { name: 'ops', connection: 'memory', concurrency: 2, batchSize: 10 },
    }),
    workers: defineWorkers({
      main: { queues: ['ops'], concurrency: 1, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { memory: new InMemoryQueueStorage() },
  });

  await supervisor.start();

  await supervisor.jobManager.dispatch(new FastJob({ id: 'f-001' }));
  await supervisor.jobManager.dispatch(new SlowJob({ id: 's-001' }));
  await supervisor.jobManager.dispatch(new FastJob({ id: 'f-002' }), { delayMs: 30_000 });

  const status1 = await supervisor.getQueueStatus('ops');
  console.log('queue status (initial):', status1);

  const deferredBefore = await supervisor.queryDeferredJobs({ queueName: 'ops', status: 'pending', limit: 10 });
  console.log('deferred before:', deferredBefore.map((job) => job.id));

  if (deferredBefore[0]) {
    await supervisor.promoteJob('ops', deferredBefore[0].id);
  }

  const readyAfterPromote = await supervisor.getReadyJobs({ queueName: 'ops', limit: 10 });
  console.log('ready after promote:', readyAfterPromote.map((job) => job.id));

  if (readyAfterPromote[0]) {
    await supervisor.removeJob('ops', readyAfterPromote[0].id);
  }

  await new Promise((resolve) => setTimeout(resolve, 1_200));

  const completed = await supervisor.getCompletedJobs({ queueName: 'ops', limit: 10 });
  console.log('completed jobs:', completed.map((job) => job.id));

  const removed = await supervisor.cleanJobs('ops', {
    status: 'deferred',
    graceMs: 0,
    limit: 100,
  });
  console.log('cleaned jobs count:', removed);

  const finalStatus = await supervisor.getQueueStatus('ops');
  console.log('queue status (final):', finalStatus);

  const obliterated = await supervisor.obliterateQueue('ops');
  console.log('obliterated jobs count:', obliterated);

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
