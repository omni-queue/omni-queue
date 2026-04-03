import {
  InMemoryQueueStorage,
  Job,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
} from '@vasto/core';

class PrepareAssetJob extends Job<{ assetId: string }> {
  static jobName = 'prepare-asset';
  override jobName = PrepareAssetJob.jobName;

  override queue() {
    return 'workflow';
  }

  override async handle(payload: { assetId: string }) {
    await this.reportProgress(50);
    await this.reportProgress(100);
    return { prepared: payload.assetId };
  }
}

class TranscodeAssetJob extends Job<{ assetId: string; profile: '720p' | '1080p' }> {
  static jobName = 'transcode-asset';
  override jobName = TranscodeAssetJob.jobName;

  override queue() {
    return 'workflow';
  }

  override async handle(payload: { assetId: string; profile: '720p' | '1080p' }) {
    return { transcoded: payload.assetId, profile: payload.profile };
  }
}

class PublishAssetJob extends Job<{ assetId: string }> {
  static jobName = 'publish-asset';
  override jobName = PublishAssetJob.jobName;

  override queue() {
    return 'notifications';
  }

  override async handle(payload: { assetId: string }) {
    return { published: payload.assetId };
  }
}

async function main() {
  const registry = new JobRegistry();
  registry.registerAll([PrepareAssetJob, TranscodeAssetJob, PublishAssetJob]);

  const supervisor = new Supervisor({
    queues: defineQueues({
      workflow: { name: 'workflow', connection: 'memory', concurrency: 4, batchSize: 10 },
      notifications: { name: 'notifications', connection: 'memory', concurrency: 2, batchSize: 10 },
    }),
    workers: defineWorkers({
      main: { queues: ['workflow', 'notifications'], concurrency: 2, isolation: 'inline' },
    }),
    registry,
    storageAdapters: { memory: new InMemoryQueueStorage() },
  });

  const unsubscribe = supervisor.subscribeLifecycleEvents((event) => {
    if (event.type.startsWith('job.')) {
      console.log('[event]', event.type, event.queueName ?? 'n/a', event.jobId ?? '');
    }
  });

  await supervisor.start();

  const flow = await supervisor.dispatchFlow(
    [
      { id: 'prepare', job: new PrepareAssetJob({ assetId: 'asset-001' }) },
      {
        id: 'transcode',
        job: new TranscodeAssetJob({ assetId: 'asset-001', profile: '1080p' }),
        dependsOn: ['prepare'],
      },
      {
        id: 'publish',
        job: new PublishAssetJob({ assetId: 'asset-001' }),
        dependsOn: ['transcode'],
      },
    ],
    { flowId: 'asset-pipeline-001', atomicFailure: true }
  );

  console.log('initial flow state:', JSON.stringify(flow, null, 2));

  const batchId = await supervisor.jobManager.dispatchBatch('post-publish-hooks', [
    new PublishAssetJob({ assetId: 'asset-001' }),
    new PublishAssetJob({ assetId: 'asset-002' }),
  ]);
  console.log('batch created:', batchId);

  await supervisor.jobManager.schedule(new PublishAssetJob({ assetId: 'asset-003' }), {
    runAt: Date.now() + 2_000,
  });
  console.log('scheduled one-time publish for asset-003');

  await new Promise((resolve) => setTimeout(resolve, 3_000));

  const latestFlow = supervisor.getFlow('asset-pipeline-001');
  console.log('latest flow state:', JSON.stringify(latestFlow, null, 2));
  console.log('batches:', JSON.stringify(supervisor.getBatches(), null, 2));

  unsubscribe();
  await supervisor.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
