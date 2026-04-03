import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@vasto/core';

class ReminderJob extends Job<{ channel: string; message: string }> {
  static jobName = 'reminder-job';
  override jobName = ReminderJob.jobName;

  override queue() {
    return 'reminders';
  }

  override async handle(payload: { channel: string; message: string }) {
    return { delivered: true, channel: payload.channel, message: payload.message };
  }
}

async function main() {
  const registry = new JobRegistry();
  registry.register(ReminderJob);

  const supervisor = new Supervisor({
    queues: defineQueues({
      reminders: { name: 'reminders', connection: 'memory', concurrency: 2, batchSize: 10 },
    }),
    workers: defineWorkers({
      main: { queues: ['reminders'], concurrency: 1, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { memory: new InMemoryQueueStorage() },
  });

  await supervisor.start();

  await supervisor.jobManager.dispatch(
    new ReminderJob({ channel: 'email', message: 'delayed by 10s then promoted manually' }),
    { delayMs: 10_000 }
  );

  const oneTime = await supervisor.jobManager.schedule(
    new ReminderJob({ channel: 'sms', message: 'one-time runAt schedule' }),
    { runAt: Date.now() + 1_500 }
  );

  const interval = await supervisor.jobManager.schedule(
    new ReminderJob({ channel: 'push', message: 'interval schedule every 2s' }),
    { intervalMs: 2_000 }
  );

  const cron = await supervisor.jobManager.schedule(
    new ReminderJob({ channel: 'slack', message: 'cron schedule every 3s' }),
    { pattern: '*/3 * * * * *', timezone: 'UTC', durable: false }
  );

  console.log('schedule handles:', {
    oneTime: oneTime.id,
    interval: interval.id,
    cron: cron.id,
  });

  await new Promise((resolve) => setTimeout(resolve, 2_500));

  const deferred = await supervisor.queryDeferredJobs({ queueName: 'reminders', status: 'pending', limit: 20 });
  console.log('deferred jobs before promote:', deferred.map((job) => ({ id: job.id, delayUntil: job.delayUntil })));

  const manualDelayed = deferred.find((job) => (job.payload as { message?: string }).message?.includes('manually'));
  if (manualDelayed) {
    const promoted = await supervisor.promoteJob('reminders', manualDelayed.id);
    console.log('manual delayed job promoted:', promoted);
  }

  await new Promise((resolve) => setTimeout(resolve, 4_500));

  interval.stop();
  cron.stop();
  console.log('stopped recurring schedules');

  const completed = await supervisor.getCompletedJobs({ queueName: 'reminders', limit: 50 });
  console.log('completed sample:', completed.slice(0, 5).map((job) => ({ id: job.id, name: job.name })));

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
