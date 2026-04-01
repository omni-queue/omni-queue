import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@omni-queue/core';

class ChargeCustomerJob extends Job<{ orderId: string; amount: number }> {
  static jobName = 'charge-customer';
  override jobName = ChargeCustomerJob.jobName;

  override queue() {
    return 'payments';
  }

  override async handle(payload: { orderId: string; amount: number }) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { charged: true, orderId: payload.orderId, amount: payload.amount };
  }
}

async function main() {
  const registry = new JobRegistry();
  registry.register(ChargeCustomerJob);

  const supervisor = new Supervisor({
    queues: defineQueues({
      payments: {
        name: 'payments',
        connection: 'memory',
        concurrency: 2,
        batchSize: 10,
        idempotency: {
          dedupeWindowMs: 2_000,
          includeFailed: true,
        },
      },
    }),
    workers: defineWorkers({
      main: { queues: ['payments'], concurrency: 1, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { memory: new InMemoryQueueStorage() },
  });

  await supervisor.start();

  const key = 'order-1001-charge';

  const id1 = await supervisor.jobManager.dispatch(
    new ChargeCustomerJob({ orderId: 'order-1001', amount: 4999 }),
    { idempotencyKey: key }
  );

  const id2 = await supervisor.jobManager.dispatch(
    new ChargeCustomerJob({ orderId: 'order-1001', amount: 4999 }),
    { idempotencyKey: key }
  );

  console.log('dedupe during in-flight:', { id1, id2, same: id1 === id2 });

  await new Promise((resolve) => setTimeout(resolve, 800));

  const id3 = await supervisor.jobManager.dispatch(
    new ChargeCustomerJob({ orderId: 'order-1001', amount: 4999 }),
    { idempotencyKey: key }
  );

  console.log('dedupe against recent completed job:', { id1, id3, same: id1 === id3 });

  await new Promise((resolve) => setTimeout(resolve, 2_200));

  const id4 = await supervisor.jobManager.dispatch(
    new ChargeCustomerJob({ orderId: 'order-1001', amount: 4999 }),
    { idempotencyKey: key }
  );

  console.log('after dedupe window expires:', { id1, id4, same: id1 === id4 });

  await new Promise((resolve) => setTimeout(resolve, 500));

  const completed = await supervisor.getCompletedJobs({ queueName: 'payments', limit: 20 });
  console.log('completed charge jobs:', completed.map((job) => ({ id: job.id, key: job.idempotencyKey })));

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
