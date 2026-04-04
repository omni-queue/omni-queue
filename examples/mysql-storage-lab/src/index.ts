import { Job, JobRegistry, Supervisor, defineQueues, defineWorkers } from '@vasto/core';
import { MySqlStore } from '@vasto/mysql-store';

class MySqlEmailJob extends Job<{ to: string; subject: string }> {
  static jobName = 'mysql-email';
  override jobName = MySqlEmailJob.jobName;

  override queue() {
    return 'emails';
  }

  override async handle(payload: { to: string; subject: string }) {
    return { delivered: true, to: payload.to, subject: payload.subject };
  }
}

async function main() {
  const uri = process.env.MYSQL_URL;
  if (!uri) throw new Error('Set MYSQL_URL before running mysql-storage-lab');

  const store = new MySqlStore({ pool: { uri, connectionLimit: 10 } });
  await store.migrate();

  const registry = new JobRegistry();
  registry.register(MySqlEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ emails: { name: 'emails', connection: 'mysql', concurrency: 2, batchSize: 10 } }),
    workers: defineWorkers({ main: { queues: ['emails'], concurrency: 1, isolation: 'inline' } }),
    registry,
    storageAdapters: { mysql: store },
  });

  await supervisor.start();
  await supervisor.jobManager.dispatch(new MySqlEmailJob({ to: 'mysql@example.com', subject: 'Hello from MySQL' }));
  await new Promise((resolve) => setTimeout(resolve, 500));

  const completed = await supervisor.getCompletedJobs({ queueName: 'emails', limit: 10 });
  console.log('completed jobs:', completed.map((job) => ({ id: job.id, name: job.name })));

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
