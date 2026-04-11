import path from 'node:path';
import { Elysia } from 'elysia';
import {
  FileQueueStorage,
  JobRegistry,
  resolveSupervisorMode,
  Supervisor,
  type SupervisorMode,
  defineQueues,
  defineWorkers,
} from '@vasto-queue/core';
import { registerElysiaAdapter } from '@vasto-queue/elysia-adapter';
import { ElysiaEmailJob } from './jobs';

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

async function main() {
  const API_BASE = normalizeBasePath(process.env.DASHBOARD_API_BASE ?? '/api/dashboard-api');
  const UI_BASE = normalizeBasePath(process.env.DASHBOARD_UI_BASE ?? '/secured-dashboard');
  const UI_DIR = path.resolve(process.cwd(), process.env.DASHBOARD_UI_DIR ?? 'public/vasto-dashboard');
  const QUEUE_DATA_DIR = path.resolve(process.cwd(), process.env.QUEUE_DATA_DIR ?? 'queue-data');
  const supervisorMode: SupervisorMode = resolveSupervisorMode(process.env.SUPERVISOR_MODE);
  const recoverRepeatables = process.env.RECOVER_REPEATABLES === 'true';

  const registry = new JobRegistry();
  registry.register(ElysiaEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({
      emails: { name: 'emails', connection: 'file', concurrency: 2, batchSize: 10 },
    }),
    workers:
      supervisorMode === 'hybrid' || supervisorMode === 'worker'
        ? defineWorkers({ emailWorker: { queues: ['emails'], concurrency: 1, isolation: 'inline' } })
        : defineWorkers({}),
    registry,
    storageAdapters: { file: new FileQueueStorage(QUEUE_DATA_DIR) },
    repeatables: {
      recoverOnStart: recoverRepeatables,
    },
  });

  await supervisor.start(supervisorMode);

  const app = new Elysia();

  const dashboard = registerElysiaAdapter(app, {
    supervisor,
    apiBase: API_BASE,
    uiDir: UI_DIR,
    uiBase: UI_BASE,
    protectUiWithAuth: false,
  });

  app
    .get('/', () => ({
      status: 'ok',
      supervisorMode,
      enqueueRoute: '/jobs/email',
      dashboardRoute: UI_BASE,
      dashboardApiBase: API_BASE,
      dashboardUiDir: UI_DIR,
    }))
    .post('/jobs/email', async ({ body, set }) => {
      const payload = body as Partial<{ to: string; subject: string; body: string }>;
      if (!payload.to || !payload.subject || !payload.body) {
        set.status = 400;
        return { error: 'Expected payload: { to, subject, body }' };
      }

      const jobId = await supervisor.jobManager.dispatch(
        new ElysiaEmailJob({ to: payload.to, subject: payload.subject, body: payload.body })
      );

      set.status = 202;
      return { status: 'queued', jobId };
    });

  void dashboard.waitUntilReady().catch((error) => {
    console.warn('Dashboard adapter readiness warning:', error);
  });
  app.listen({ port: 3020, hostname: '0.0.0.0' });

  console.log('Elysia example running on http://localhost:3020');
  console.log(`Supervisor mode: ${supervisorMode}`);
  console.log(`Repeatable recovery on start: ${recoverRepeatables ? 'enabled' : 'disabled'}`);
  if (supervisorMode === 'api') {
    console.warn('API mode does not process jobs. Run `bun run worker` or set SUPERVISOR_MODE=hybrid.');
  }
  console.log(`Queue data dir: ${QUEUE_DATA_DIR}`);
  console.log(`Dashboard API base: ${API_BASE}`);
  console.log(`Dashboard UI base: ${UI_BASE}`);
  console.log(`Dashboard UI dir: ${UI_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
