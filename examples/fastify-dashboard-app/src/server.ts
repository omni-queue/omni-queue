import path from 'node:path';
import Fastify from 'fastify';
import {
  FileQueueStorage,
  Job,
  JobRegistry,
  resolveSupervisorMode,
  Supervisor,
  type SupervisorMode,
  defineQueues,
  defineWorkers,
} from '@omni-queue/core';
import { bindOmniQueueFastifyWebSocket, omniQueueFastifyAdapter } from '@omni-queue/fastify-adapter';

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

class FastifyEmailJob extends Job<{ to: string; subject: string; body: string }> {
  static jobName = 'fastify-email';
  override jobName = FastifyEmailJob.jobName;
  override queue() { return 'emails'; }
  override async handle(payload: { to: string; subject: string; body: string }) {
    return { queuedFrom: 'fastify', to: payload.to, subject: payload.subject };
  }
}

async function main() {
  const API_BASE = normalizeBasePath(process.env.DASHBOARD_API_BASE ?? '/api/dashboard-api');
  const UI_BASE = normalizeBasePath(process.env.DASHBOARD_UI_BASE ?? '/secured-dashboard');
  const UI_DIR = path.resolve(process.cwd(), process.env.DASHBOARD_UI_DIR ?? 'public/omni-queue-dashboard');
  const QUEUE_DATA_DIR = path.resolve(process.cwd(), process.env.QUEUE_DATA_DIR ?? 'queue-data');
  const supervisorMode: SupervisorMode = resolveSupervisorMode(process.env.SUPERVISOR_MODE);
  const recoverRepeatables = process.env.RECOVER_REPEATABLES === 'true';

  const registry = new JobRegistry();
  registry.register(FastifyEmailJob);

  const supervisor = new Supervisor({
    queues: defineQueues({ emails: { name: 'emails', connection: 'file', concurrency: 2, batchSize: 10 } }),
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

  const app = Fastify({ logger: false });
  const dashboardOptions = {
    supervisor,
    apiBase: API_BASE,
    uiDir: UI_DIR,
    uiBase: UI_BASE,
    protectUiWithAuth: false,
  };

  const dashboardHandler = omniQueueFastifyAdapter(dashboardOptions);

  for (const routePath of new Set([API_BASE, `${API_BASE}/*`, UI_BASE, `${UI_BASE}/*`])) {
    app.all(routePath, async (request, reply) => {
      reply.hijack();
      dashboardHandler(request.raw, reply.raw);
    });
  }

  const dashboardWsController = bindOmniQueueFastifyWebSocket(app.server, dashboardOptions);
  app.addHook('onClose', async () => {
    dashboardWsController.close();
  });

  app.post('/jobs/email', async (request, reply) => {
    const payload = request.body as Partial<{ to: string; subject: string; body: string }>;
    if (!payload.to || !payload.subject || !payload.body) {
      reply.status(400);
      return { error: 'Expected payload: { to, subject, body }' };
    }

    const jobId = await supervisor.jobManager.dispatch(
      new FastifyEmailJob({ to: payload.to, subject: payload.subject, body: payload.body })
    );

    reply.status(202);
    return { status: 'queued', jobId };
  });

  app.get('/', async () => ({
    status: 'ok',
    supervisorMode,
    enqueueRoute: '/jobs/email',
    dashboardRoute: UI_BASE,
    dashboardApiBase: API_BASE,
    dashboardUiDir: UI_DIR,
  }));

  await app.listen({ port: 3030, host: '0.0.0.0' });
  await supervisor.start(supervisorMode);
  console.log('Fastify example running on http://localhost:3030');
  console.log(`Supervisor mode: ${supervisorMode}`);
  console.log(`Repeatable recovery on start: ${recoverRepeatables ? 'enabled' : 'disabled'}`);
  if (supervisorMode === 'api') {
    console.warn('API mode does not process jobs. Run `npm run worker` or set SUPERVISOR_MODE=hybrid.');
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
