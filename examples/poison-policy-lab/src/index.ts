import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@vasto/core';

class AlwaysFailJob extends Job<{ id: string; queueName: string }> {
  static jobName = 'always-fail';
  override jobName = AlwaysFailJob.jobName;

  override queue() {
    return this.payload.queueName;
  }

  override async handle(payload: { id: string; queueName: string }) {
    throw new Error(`POISON:${payload.id}`);
  }
}

async function main() {
  const registry = new JobRegistry();
  registry.register(AlwaysFailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({
      quarantine: {
        name: 'quarantine',
        connection: 'memory',
        concurrency: 1,
        batchSize: 5,
        maxAttempts: 1,
        reliability: {
          poisonPolicy: { template: 'quarantine', maxFailures: 1 },
        },
      },
      snooze: {
        name: 'snooze',
        connection: 'memory',
        concurrency: 1,
        batchSize: 5,
        maxAttempts: 1,
        reliability: {
          poisonPolicy: { template: 'auto-snooze', maxFailures: 1, snoozeMs: 1_500 },
        },
      },
      escalate: {
        name: 'escalate',
        connection: 'memory',
        concurrency: 1,
        batchSize: 5,
        maxAttempts: 1,
        reliability: {
          poisonPolicy: { template: 'escalation', maxFailures: 1, escalationTag: 'severity:p1' },
        },
      },
    }),
    workers: defineWorkers({
      main: { queues: ['quarantine', 'snooze', 'escalate'], concurrency: 1, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { memory: new InMemoryQueueStorage() },
  });

  await supervisor.start();

  await supervisor.jobManager.dispatch(new AlwaysFailJob({ id: 'q-001', queueName: 'quarantine' }));
  await supervisor.jobManager.dispatch(new AlwaysFailJob({ id: 's-001', queueName: 'snooze' }));
  await supervisor.jobManager.dispatch(new AlwaysFailJob({ id: 'e-001', queueName: 'escalate' }));

  await new Promise((resolve) => setTimeout(resolve, 500));

  const quarantineDlq = await supervisor.getDLQ({ queueName: 'quarantine', limit: 10 });
  const escalateDlq = await supervisor.getDLQ({ queueName: 'escalate', limit: 10 });
  const snoozed = await supervisor.queryDeferredJobs({ queueName: 'snooze', status: 'pending', limit: 10 });

  console.log('quarantine DLQ tags:', quarantineDlq.map((job) => ({ id: job.id, tags: job.tags })));
  console.log('escalation DLQ tags:', escalateDlq.map((job) => ({ id: job.id, tags: job.tags })));
  console.log('auto-snoozed deferred jobs:', snoozed.map((job) => ({ id: job.id, tags: job.tags, delayUntil: job.delayUntil })));

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
