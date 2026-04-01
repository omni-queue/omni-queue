import http from 'node:http';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { FileQueueStorage, Job, JobRegistry, Supervisor, defineQueues, defineWorkers } from '@omni-queue/core';
import { bindOmniQueueHonoWebSocket, omniQueueHonoAdapter } from '@omni-queue/hono-adapter';

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

function matchesBasePath(requestUrl: string, basePath: string): boolean {
  const pathname = requestUrl.split('?')[0] ?? '';
  if (basePath === '/') {
    return pathname === '/' || pathname.startsWith('/');
  }

  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

class HonoEmailJob extends Job<{ to: string; subject: string; body: string }> {
  static jobName = 'hono-email';
  override jobName = HonoEmailJob.jobName;
  override queue() { return 'emails'; }
  override async handle(payload: { to: string; subject: string; body: string }) {
    return { queuedFrom: 'hono', to: payload.to, subject: payload.subject };
  }
}

async function main() {
  const API_BASE = normalizeBasePath(process.env.DASHBOARD_API_BASE ?? '/api/dashboard-api');
  const UI_BASE = normalizeBasePath(process.env.DASHBOARD_UI_BASE ?? '/secured-dashboard');
  const UI_DIR = path.resolve(process.cwd(), process.env.DASHBOARD_UI_DIR ?? 'public/omni-queue-dashboard');
  const QUEUE_DATA_DIR = path.resolve(process.cwd(), process.env.QUEUE_DATA_DIR ?? 'queue-data');

  const registry = new JobRegistry();
  registry.register(HonoEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ emails: { name: 'emails', connection: 'file', concurrency: 2, batchSize: 10 } }),
    workers: defineWorkers({ emailWorker: { queues: ['emails'], concurrency: 1, isolation: 'inline' } }),
    registry,
    storageAdapters: { file: new FileQueueStorage(QUEUE_DATA_DIR) },
  });

  await supervisor.start('api');

  const dashboardOptions = {
    supervisor,
    apiBase: API_BASE,
    uiBase: UI_BASE,
    uiDir: UI_DIR,
    protectUiWithAuth: false,
  };

  const dashboardHandler = omniQueueHonoAdapter(dashboardOptions);

  const app = new Hono();

  app.get('/', (c) =>
    c.json({
      status: 'ok',
      enqueueRoute: '/jobs/email',
      dashboardRoute: UI_BASE,
      dashboardApiBase: API_BASE,
      dashboardUiDir: UI_DIR,
    })
  );

  app.post('/jobs/email', async (c) => {
    const payload = (await c.req.json()) as Partial<{ to: string; subject: string; body: string }>;
    if (!payload.to || !payload.subject || !payload.body) {
      return c.json({ error: 'Expected payload: { to, subject, body }' }, 400);
    }

    const jobId = await supervisor.jobManager.dispatch(
      new HonoEmailJob({ to: payload.to, subject: payload.subject, body: payload.body })
    );

    return c.json({ status: 'queued', jobId }, 202);
  });

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (matchesBasePath(url, API_BASE) || matchesBasePath(url, UI_BASE)) {
      dashboardHandler(req, res);
      return;
    }

    const honoHandler = getRequestListener(app.fetch);
    honoHandler(req, res);
  });

  const dashboardWsController = bindOmniQueueHonoWebSocket(server, dashboardOptions);
  server.once('close', () => {
    dashboardWsController.close();
  });

  server.listen(3040, () => {
    console.log('Hono example running on http://localhost:3040');
    console.log(`Queue data dir: ${QUEUE_DATA_DIR}`);
    console.log(`Dashboard API base: ${API_BASE}`);
    console.log(`Dashboard UI base: ${UI_BASE}`);
    console.log(`Dashboard UI dir: ${UI_DIR}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
