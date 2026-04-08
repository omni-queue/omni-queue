import { Job, JobRegistry, Supervisor, defineQueues, defineWorkers } from '@vasto-queue/core';
import { DynamoDbStore } from '@vasto-queue/dynamodb-store';

class DynamoEmailJob extends Job<{ to: string; subject: string }> {
  static jobName = 'dynamodb-email';
  override jobName = DynamoEmailJob.jobName;

  override queue() {
    return 'emails';
  }

  override async handle(payload: { to: string; subject: string }) {
    return { delivered: true, to: payload.to, subject: payload.subject };
  }
}

async function main() {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const endpoint = process.env.DYNAMODB_ENDPOINT;

  const store = new DynamoDbStore({
    region,
    ...(endpoint ? { clientConfig: { endpoint } } : {}),
    tableName: process.env.DYNAMODB_TABLE ?? 'vasto_jobs',
    deadLetterTableName: process.env.DYNAMODB_DLQ_TABLE ?? 'vasto_dead_letter',
    completedTableName: process.env.DYNAMODB_COMPLETED_TABLE ?? 'vasto_completed',
  });

  await store.migrate();

  const registry = new JobRegistry();
  registry.register(DynamoEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ emails: { name: 'emails', connection: 'dynamodb', concurrency: 2, batchSize: 10 } }),
    workers: defineWorkers({ main: { queues: ['emails'], concurrency: 1, isolation: 'inline' } }),
    registry,
    storageAdapters: { dynamodb: store },
  });

  await supervisor.start();
  await supervisor.jobManager.dispatch(new DynamoEmailJob({ to: 'dynamodb@example.com', subject: 'Hello from DynamoDB' }));
  await new Promise((resolve) => setTimeout(resolve, 500));

  const completed = await supervisor.getCompletedJobs({ queueName: 'emails', limit: 10 });
  console.log('completed jobs:', completed.map((job) => ({ id: job.id, name: job.name })));

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
