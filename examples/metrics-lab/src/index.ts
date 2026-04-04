import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@vasto/core';
import {
  MetricsCollector,
  QueueMetricsPlugin,
  exportDataDog,
  exportPrometheus,
  exportStatsD,
} from '@vasto/metrics';

class MetricsEmailJob extends Job<{ to: string }> {
  static jobName = 'metrics-email';
  override jobName = MetricsEmailJob.jobName;

  override queue() {
    return 'emails';
  }

  override async handle(payload: { to: string }) {
    await this.reportProgress(50);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await this.reportProgress(100);
    return { sent: true, to: payload.to };
  }
}

async function main() {
  const collector = new MetricsCollector();
  const registry = new JobRegistry();
  registry.register(MetricsEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({
      emails: { name: 'emails', connection: 'memory', concurrency: 2, batchSize: 10 },
    }),
    workers: defineWorkers({
      main: { queues: ['emails'], concurrency: 1, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { memory: new InMemoryQueueStorage() },
    globalPlugins: [new QueueMetricsPlugin(collector)],
  });

  await supervisor.start();

  await supervisor.jobManager.dispatch(new MetricsEmailJob({ to: 'alpha@example.com' }));
  await supervisor.jobManager.dispatch(new MetricsEmailJob({ to: 'beta@example.com' }));

  await new Promise((resolve) => setTimeout(resolve, 500));

  collector.setGauge('queue_depth', await supervisor.getQueueDepth(['emails']), { queue: 'emails' });
  const snapshot = collector.snapshot();

  console.log('snapshot:', JSON.stringify(snapshot, null, 2));
  console.log('prometheus:\n' + exportPrometheus(snapshot));
  console.log('statsd:', exportStatsD(snapshot, { prefix: 'vasto' }));
  console.log('datadog:', exportDataDog(snapshot, { prefix: 'vasto' }));

  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
