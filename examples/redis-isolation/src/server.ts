import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DashboardAuthContext } from '@omni-queue/core';
import { JobManager, Supervisor } from '@omni-queue/core';
import { createExpressAdapter, createExpressWebSocketBinding } from '@omni-queue/express-adapter';
import 'dotenv/config';
import {
  GenerateThumbnailJob,
  SendWelcomeEmailJob,
  TranscodeVideoJob,
} from './jobs';
import {
  createConsumerWorkers,
  createProducerWorkers,
  createQueues,
  createRedisStoreFromEnv,
  createRegistry,
} from './runtime';
import { registerGracefulShutdown } from './graceful-shutdown';

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return undefined;
}

function asNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return undefined;
}

function asJobPriority(value: unknown): 'critical' | 'high' | 'normal' | 'low' | undefined {
  if (value === 'critical' || value === 'high' || value === 'normal' || value === 'low') {
    return value;
  }
  return undefined;
}

function buildAdminContext(): DashboardAuthContext {
  return { role: 'admin' };
}

function createDashboardSessionToken(username: string): string {
  return Buffer.from(`omni-queue-dashboard:server:${username}`).toString('base64url');
}


async function main() {
  const port = Number(process.env.PORT ?? '3100');
  const dashboardUiDir = path.resolve(process.cwd(), 'public/omni-queue-dashboard');
  const store = createRedisStoreFromEnv();
  const queues = createQueues();
  const workers = createProducerWorkers();
  const consumerWorkerDefs = createConsumerWorkers();
  const registry = createRegistry();

  const storageAdapters = {
    redis: store,
  };

  const jobManager = new JobManager(queues, workers, registry, storageAdapters);

  // Create Supervisor for dashboard integration
  const supervisor = new Supervisor({
    queues,
    workers: consumerWorkerDefs,
    registry,
    storageAdapters,
  });

  const app = express();
  app.use(express.json());

  // Job API endpoints
  app.post('/jobs/email', async (req, res) => {
    try {
      const to = asString(req.body.to);
      const subject = asString(req.body.subject);
      const content = asString(req.body.body);

      if (to == null || subject == null || content == null) {
        res.status(400).json({ error: 'Expected payload: { to, subject, body }' });
        return;
      }

      const job = new SendWelcomeEmailJob({ to, subject, body: content });
      const priority = asJobPriority(req.body.priority);
      await jobManager.dispatch(job, priority ? { priority } : undefined);

      res.status(202).json({
        status: 'queued',
        requestId: randomUUID(),
        jobName: SendWelcomeEmailJob.jobName,
        queue: job.queue(),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  app.post('/jobs/email/schedule', async (req, res) => {
    try {
      const to = asString(req.body.to);
      const subject = asString(req.body.subject);
      const content = asString(req.body.body);
      const delayMs = asNonNegativeNumber(req.body.delayMs);
      const runAt = asPositiveNumber(req.body.runAt);
      const intervalMs = asPositiveNumber(req.body.intervalMs);
      const pattern = asString(req.body.pattern);
      const timezone = asString(req.body.timezone);

      if (!to || !subject || !content) {
        res.status(400).json({
          error:
            'Expected payload: { to, subject, body, delayMs? | runAt? | intervalMs? | pattern?, timezone? }',
        });
        return;
      }

      const configuredModes = [delayMs, runAt, intervalMs, pattern].filter(
        (value) => value !== undefined
      );

      if (configuredModes.length !== 1) {
        res.status(400).json({
          error: 'Provide exactly one scheduling mode: delayMs, runAt, intervalMs, or pattern',
        });
        return;
      }

      const job = new SendWelcomeEmailJob({ to, subject, body: content });

      if (delayMs !== undefined) {
        await jobManager.dispatch(job, { delayMs });

        res.status(202).json({
          status: 'scheduled',
          mode: 'delayMs',
          requestId: randomUUID(),
          jobName: SendWelcomeEmailJob.jobName,
          queue: job.queue(),
          delayMs,
        });
        return;
      }

      const handle = await jobManager.schedule(job, {
        ...(runAt !== undefined ? { runAt } : {}),
        ...(intervalMs !== undefined ? { intervalMs } : {}),
        ...(pattern !== undefined ? { pattern } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
      });

      res.status(202).json({
        status: 'scheduled',
        mode:
          runAt !== undefined
            ? 'runAt'
            : intervalMs !== undefined
              ? 'intervalMs'
              : 'pattern',
        scheduleId: handle.id,
        jobName: SendWelcomeEmailJob.jobName,
        queue: job.queue(),
        ...(runAt !== undefined ? { runAt } : {}),
        ...(intervalMs !== undefined ? { intervalMs } : {}),
        ...(pattern !== undefined ? { pattern } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  app.post('/jobs/thumbnail', async (req, res) => {
    try {
      const videoId = asString(req.body.videoId);
      const sourcePath = asString(req.body.sourcePath);
      const outputPath = asString(req.body.outputPath);

      if (!videoId || !sourcePath || !outputPath) {
        res.status(400).json({
          error: 'Expected payload: { videoId, sourcePath, outputPath }',
        });
        return;
      }

      const job = new GenerateThumbnailJob({ videoId, sourcePath, outputPath });
      await jobManager.dispatch(job);

      res.status(202).json({
        status: 'queued',
        requestId: randomUUID(),
        jobName: GenerateThumbnailJob.jobName,
        queue: job.queue(),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  app.post('/jobs/transcode', async (req, res) => {
    try {
      const videoId = asString(req.body.videoId);
      const sourcePath = asString(req.body.sourcePath);
      const targetPath = asString(req.body.targetPath);
      const profile = asString(req.body.profile);
      const segmentCount = asPositiveNumber(req.body.segmentCount) ?? 6;

      if (!videoId || !sourcePath || !targetPath) {
        res.status(400).json({
          error: 'Expected payload: { videoId, sourcePath, targetPath, profile?, segmentCount? }',
        });
        return;
      }

      const selectedProfile =
        profile === '1080p' || profile === '720p' || profile === '480p' ? profile : '1080p';

      const job = new TranscodeVideoJob({
        videoId,
        sourcePath,
        targetPath,
        profile: selectedProfile,
        segmentCount,
      });
      await jobManager.dispatch(job);

      res.status(202).json({
        status: 'queued',
        requestId: randomUUID(),
        jobName: TranscodeVideoJob.jobName,
        queue: job.queue(),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  app.post('/jobs/progress', async (req, res) => {
    try {
      const jobId = asString(req.body.jobId);
      const queueName = asString(req.body.queueName);
      const progress = asNonNegativeNumber(req.body.progress);

      if (!jobId || !queueName || progress === undefined || progress > 100) {
        res.status(400).json({
          error: 'Expected payload: { jobId, queueName, progress } with progress in [0..100]',
        });
        return;
      }

      await jobManager.setProgress(jobId, queueName, progress);

      res.status(202).json({
        status: 'updated',
        requestId: randomUUID(),
        jobId,
        queueName,
        progress,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  app.post('/dlq/retry', async (req, res) => {
    try {
      const queueName = asString(req.body.queueName);
      const jobId = asString(req.body.jobId);

      if (!queueName || !jobId) {
        res.status(400).json({ error: 'Expected payload: { queueName, jobId }' });
        return;
      }

      const retried = await store.retryDeadLetterJob(queueName, jobId);
      if (!retried) {
        res.status(404).json({ error: 'Dead-letter job not found' });
        return;
      }

      res.status(202).json({
        status: 'retried',
        requestId: randomUUID(),
        queueName,
        jobId,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'redis-isolation-api' });
  });

  const dashboardAuth = {
    type: 'basic' as const,
    authHandler: (request: { mode: 'password' | 'custom' | 'token'; username?: string; password?: string }) => {
      if (request.mode === 'token') {
        return null;
      }

      const username = process.env.DASHBOARD_BASIC_USERNAME;
      const password = process.env.DASHBOARD_BASIC_PASSWORD;
      if (
        username === undefined ||
        password === undefined ||
        request.username !== username ||
        request.password !== password
      ) {
        return null;
      }

      return {
        token: createDashboardSessionToken(username),
        authContext: buildAdminContext(),
      };
    },
    sessionValidator: (credentials: { token: string }) => {
      const username = process.env.DASHBOARD_BASIC_USERNAME;
      if (!username) {
        return false;
      }

      return credentials.token === createDashboardSessionToken(username)
        ? buildAdminContext()
        : false;
    },
  };

  app.use(
    createExpressAdapter({
      supervisor,
      apiBase: '/api/dashboard',
      streamIntervalMs: 2000,
      uiDir: dashboardUiDir,
      uiBase: '/',
      protectUiWithAuth: false,
      auth: dashboardAuth,
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
    auth: dashboardAuth,
  });

  console.log('[api] GET  /health');
  console.log('[api] POST /jobs/email');
  console.log('[api] POST /jobs/email/schedule');
  console.log('[api] POST /jobs/thumbnail');
  console.log('[api] POST /jobs/transcode');
  console.log('[api] POST /jobs/progress');
  console.log('[api] POST /dlq/retry');
  console.log('[api] Dashboard UI: http://localhost:4173 (dev) or http://localhost:3100/ (production)');

  registerGracefulShutdown({
    label: 'api',
    onShutdown: async () => {
      jobManager.stopSchedules();
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
      await store.close();
    },
  });
}

main().catch((error) => {
  console.error('[api] fatal:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
