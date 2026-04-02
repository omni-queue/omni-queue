import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@omni-queue/core';

class ArchiveEmailJob extends Job<{ to: string; subject: string }> {
  static jobName = 'archive-email';
  override jobName = ArchiveEmailJob.jobName;

  override queue() {
    return 'archive';
  }

  override async handle(payload: { to: string; subject: string }) {
    return { accepted: true, to: payload.to, subject: payload.subject };
  }
}

async function main() {
  const registry = new JobRegistry();
  registry.register(ArchiveEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({
      archive: { name: 'archive', connection: 'memory', concurrency: 2, batchSize: 10 },
    }),
    workers: defineWorkers({
      main: { queues: ['archive'], concurrency: 1, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { memory: new InMemoryQueueStorage() },
  });

    await supervisor.start();

    await supervisor.jobManager.dispatch(new ArchiveEmailJob({ to: 'alpha@example.com', subject: 'Welcome alpha' }));
    await supervisor.jobManager.dispatch(new ArchiveEmailJob({ to: 'beta@example.com', subject: 'Welcome beta' }));
    await supervisor.jobManager.dispatch(new ArchiveEmailJob({ to: 'gamma@example.com', subject: 'Digest gamma' }));

    await new Promise((resolve) => setTimeout(resolve, 400));

    const allCompleted = await supervisor.getCompletedJobs({ queueName: 'archive', limit: 20 });
    const onlyArchiveEmail = await supervisor.queryJobArchive({ queueName: 'archive', jobName: 'archive-email', limit: 20 });
    const searchWelcome = await supervisor.queryJobArchive({ queueName: 'archive', search: 'Welcome', limit: 20 });
    const fromRecent = await supervisor.queryJobArchive({ queueName: 'archive', fromTs: Date.now() - 5_000, limit: 20 });

    console.log('completed jobs:', allCompleted.map((job) => ({ id: job.id, subject: (job.payload as { subject: string }).subject })));
    console.log('query by jobName:', onlyArchiveEmail.length);
    console.log('query by search term "Welcome":', searchWelcome.map((job) => ({ id: job.id, subject: (job.payload as { subject: string }).subject })));
    console.log('query by fromTs:', fromRecent.length);

    const cleaned = await supervisor.cleanJobs('archive', { status: 'completed', graceMs: 0, limit: 1 });
    console.log('cleaned completed rows:', cleaned);

    const remaining = await supervisor.getCompletedJobs({ queueName: 'archive', limit: 20 });
    console.log('remaining completed rows:', remaining.length);

    await supervisor.stop();
+
+  await supervisor.stop();
 }
 
 main().catch((error) => {
   console.error(error);
   process.exitCode = 1;
 });
