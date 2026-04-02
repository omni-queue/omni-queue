import {
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@omni-queue/core';
import { PostgresStore } from '@omni-queue/postgres-store';

class PostgresEmailJob extends Job<{ to: string; subject: string }> {
  static jobName = 'postgres-email';
  override jobName = PostgresEmailJob.jobName;

  override queue() {
    return 'emails';
  }

  override async handle(payload: { to: string; subject: string }) {
    return { delivered: true, to: payload.to, subject: payload.subject };
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Set DATABASE_URL before running postgres-storage-lab');
  }

  const store = new PostgresStore({
    pool: { connectionString },
  });

  await store.migrate();

  const registry = new JobRegistry();
  registry.register(PostgresEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({
      emails: {
        name: 'emails',
        connection: 'postgres',
        concurrency: 2,
        batchSize: 10,
        retry: { attempts: 3, maxAttempts: 3, backoff: 'exponential' },
      },
    }),
    workers: defineWorkers({
      main: { queues: ['emails'], concurrency: 1, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { postgres: store },
  });

  await supervisor.start();

  await supervisor.jobManager.dispatch(
    new PostgresEmailJob({ to: 'postgres@example.com', subject: 'Hello from Postgres store' })
  );

  await new Promise((resolve) => setTimeout(resolve, 500));

  const completed = await supervisor.getCompletedJobs({ queueName: 'emails', limit: 10 });
  console.log('completed jobs:', completed.map((job) => ({ id: job.id, name: job.name })));

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
