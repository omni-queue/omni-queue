import path from 'node:path';
import express from 'express';
import {
  InMemoryQueueStorage,
  JobRegistry,
  Supervisor,
  defineQueues,
  defineWorkers,
  resolveRuntimeModules,
} from '@vasto-queue/core';
import { createExpressAdapter, createExpressWebSocketBinding } from '@vasto-queue/express-adapter';
import { TracingPlugin } from '@vasto-queue/otel-plugin';
import { DAGPlugin, RateLimiterPlugin } from '@vasto-queue/plugins';
import { CleanupJob, GenerateReportJob, SendEmailJob } from './jobs/index.js';
import { registerGracefulShutdown } from './graceful-shutdown.js';

async function main() {
  const port = Number(process.env.PORT ?? '3110');
  const mainModules = resolveRuntimeModules('main');
  const dashboardUiDir = path.resolve(process.cwd(), 'public/vasto-dashboard');

  const registry = new JobRegistry();
  registry.registerAll([SendEmailJob, GenerateReportJob, CleanupJob]);

  const queues = defineQueues({
    emails: {
      name: 'emails',
      connection: 'memory',
      concurrency: 4,
      batchSize: 10,
      rateLimit: {
        capacity: 50,
        refillRate: 50,
      },
    },
    reports: {
      name: 'reports',
      connection: 'memory',
      concurrency: 2,
      batchSize: 5,
    },
    maintenance: {
      name: 'maintenance',
      connection: 'memory',
      concurrency: 1,
      batchSize: 2,
    },
  });

  const workers = defineWorkers({
    main: {
      queues: ['emails', 'reports', 'maintenance'],
      concurrency: 2,
      poolSize: 4,
      workerModule: mainModules.isolationWorkerModule,
      ...(mainModules.registryModule ? { registryModule: mainModules.registryModule } : {}),
      ...(mainModules.runtimePluginsModule ? { pluginsModule: mainModules.runtimePluginsModule } : {}),
      isolation: 'thread',
    },
  });

  const storageAdapters = {
    memory: new InMemoryQueueStorage(),
  };

  const supervisor = new Supervisor({
    queues,
    workers,
    registry,
    storageAdapters,
    globalPlugins: [new DAGPlugin(), new TracingPlugin({ tracerName: 'runtime' })],
    dashboard: {
      silencedJobs: [CleanupJob.jobName],
    },
  });

  const emailsQueue = queues.emails;
  if (!emailsQueue) {
    throw new Error('emails queue is not defined');
  }

  emailsQueue.plugins = [RateLimiterPlugin({ emails: emailsQueue })];

  // Dispatch sample jobs
  await supervisor.jobManager.dispatch(
    new SendEmailJob({
      to: 'ops@vasto-queue.local',
      subject: '[CRITICAL] Production alert',
      body: 'Immediate attention required.',
    }),
    { priority: 'critical' }
  );

  await supervisor.jobManager.dispatch(
    new SendEmailJob({
      to: 'dev@vasto-queue.local',
      subject: 'Weekly newsletter',
      body: 'Here is your weekly digest.',
    }),
    { priority: 'low' }
  );

  await supervisor.jobManager.dispatch(
    new SendEmailJob({
      to: 'support@vasto-queue.local',
      subject: 'Your ticket was updated',
      body: 'A reply was posted to your support ticket.',
    }),
    { priority: 'high' }
  );

  await supervisor.jobManager.dispatch(
    new SendEmailJob({
      to: 'dev@vasto-queue.local',
      subject: 'Hello from Vasto',
      body: 'This is a class-based job dispatch test.',
    })
  );

  await supervisor.jobManager.dispatch(
    new GenerateReportJob({
      reportId: 'sales-weekly-001',
      period: 'weekly',
    })
  );

  await supervisor.jobManager.dispatch(
    new CleanupJob({
      path: '/tmp/vasto-cache',
    })
  );

  await supervisor.jobManager.dispatchBatch('Daily operations batch', [
    new SendEmailJob({
      to: 'batch@vasto-queue.local',
      subject: 'Batch welcome email',
      body: 'This job is part of a tracked batch.',
    }),
    new GenerateReportJob({
      reportId: 'ops-daily-001',
      period: 'daily',
    }),
    new CleanupJob({
      path: '/tmp/vasto-batch-cache',
    }),
  ]);

  const app = express();

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'queue-system' });
  });

  app.use(
    createExpressAdapter({
      supervisor,
      apiBase: '/api/dashboard',
      streamIntervalMs: 2000,
      uiDir: dashboardUiDir,
      uiBase: '/',
      protectUiWithAuth: false,
    })
  );

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const started = app.listen(port, '127.0.0.1', () => resolve(started));
  });
  const dashboardSocket = createExpressWebSocketBinding(server, {
    supervisor,
    apiBase: '/api/dashboard',
    streamIntervalMs: 2000,
  });
  console.log('[server] GET  /health');
  console.log('[server] Dashboard UI: http://localhost:4173 (dev) or http://localhost:3110/ (production)');

  // Start the supervisor
  await supervisor.start();

  registerGracefulShutdown({
    label: 'server',
    onShutdown: async () => {
      supervisor.stop();
      dashboardSocket.close();
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  });

  setTimeout(() => {
    supervisor.stop();
    dashboardSocket.close();
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  }, 60000);
}

main().catch((error) => {
  console.error('[server] fatal:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
