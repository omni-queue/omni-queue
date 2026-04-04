import { Job, JobRegistry, Supervisor, defineQueues, defineWorkers } from '@vasto/core';
import { MongoStore } from '@vasto/mongo-store';

class MongoEmailJob extends Job<{ to: string; subject: string }> {
  static jobName = 'mongo-email';
  override jobName = MongoEmailJob.jobName;

  override queue() {
    return 'emails';
  }

  override async handle(payload: { to: string; subject: string }) {
    return { delivered: true, to: payload.to, subject: payload.subject };
  }
}

async function main() {
  const uri = process.env.MONGODB_URL;
  const dbName = process.env.MONGODB_DB ?? 'vasto';
  if (!uri) throw new Error('Set MONGODB_URL before running mongo-storage-lab');

  const store = new MongoStore({ client: {}, uri, dbName });
  await store.migrate();

  const registry = new JobRegistry();
  registry.register(MongoEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ emails: { name: 'emails', connection: 'mongo', concurrency: 2, batchSize: 10 } }),
    workers: defineWorkers({ main: { queues: ['emails'], concurrency: 1, isolation: 'inline' } }),
    registry,
    storageAdapters: { mongo: store },
  });

  await supervisor.start();
  await supervisor.jobManager.dispatch(new MongoEmailJob({ to: 'mongo@example.com', subject: 'Hello from MongoDB' }));
  await new Promise((resolve) => setTimeout(resolve, 500));

  const completed = await supervisor.getCompletedJobs({ queueName: 'emails', limit: 10 });
  console.log('completed jobs:', completed.map((job) => ({ id: job.id, name: job.name })));

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
