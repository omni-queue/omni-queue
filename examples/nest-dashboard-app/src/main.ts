import 'reflect-metadata';
import path from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
import { bindOmniQueueNestWebSocket, omniQueueNestAdapter } from '@omni-queue/nest-adapter';

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

class NestEmailJob extends Job<{ to: string; subject: string; body: string }> {
  static jobName = 'nest-email';
  override jobName = NestEmailJob.jobName;
  override queue() { return 'emails'; }
  override async handle(payload: { to: string; subject: string; body: string }) {
    return { queuedFrom: 'nest', to: payload.to, subject: payload.subject };
  }
}

const registry = new JobRegistry();
registry.register(NestEmailJob);

const supervisorMode: SupervisorMode = resolveSupervisorMode(process.env.SUPERVISOR_MODE);
const recoverRepeatables = process.env.RECOVER_REPEATABLES === 'true';

const supervisor = new Supervisor({
  queues: defineQueues({ emails: { name: 'emails', connection: 'file', concurrency: 2, batchSize: 10 } }),
  workers:
    supervisorMode === 'hybrid' || supervisorMode === 'worker'
      ? defineWorkers({ emailWorker: { queues: ['emails'], concurrency: 1, isolation: 'inline' } })
      : defineWorkers({}),
  registry,
  storageAdapters: {
    file: new FileQueueStorage(path.resolve(process.cwd(), process.env.QUEUE_DATA_DIR ?? 'queue-data')),
  },
  repeatables: {
    recoverOnStart: recoverRepeatables,
  },
});

@Module({
  controllers: [],
})
class AppModule {}

async function bootstrap() {
  const API_BASE = normalizeBasePath(process.env.DASHBOARD_API_BASE ?? '/api/dashboard-api');
  const UI_BASE = normalizeBasePath(process.env.DASHBOARD_UI_BASE ?? '/secured-dashboard');
  const UI_DIR = path.resolve(process.cwd(), process.env.DASHBOARD_UI_DIR ?? 'public/omni-queue-dashboard');
  const QUEUE_DATA_DIR = path.resolve(process.cwd(), process.env.QUEUE_DATA_DIR ?? 'queue-data');

  await supervisor.start(supervisorMode);

  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance() as {
    get: (path: string, handler: (req: unknown, res: { json: (payload: unknown) => void }) => void) => void;
    post: (
      path: string,
      handler: (
        req: { body?: Partial<{ to: string; subject: string; body: string }> },
        res: { status: (code: number) => { json: (payload: unknown) => void } }
      ) => Promise<void>
    ) => void;
  };

  const dashboardOptions = {
    supervisor,
    apiBase: API_BASE,
    uiDir: UI_DIR,
    uiBase: UI_BASE,
    protectUiWithAuth: false,
  };

  expressApp.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      supervisorMode,
      enqueueRoute: '/jobs/email',
      dashboardRoute: UI_BASE,
      dashboardApiBase: API_BASE,
      dashboardUiDir: UI_DIR,
    });
  });

  expressApp.post('/jobs/email', async (req, res) => {
    const payload = req.body ?? {};
    if (!payload.to || !payload.subject || !payload.body) {
      res.status(400).json({ error: 'Expected payload: { to, subject, body }' });
      return;
    }

    const jobId = await supervisor.jobManager.dispatch(
      new NestEmailJob({ to: payload.to, subject: payload.subject, body: payload.body })
    );

    res.status(202).json({ status: 'queued', jobId });
  });

  app.use(omniQueueNestAdapter(dashboardOptions));
  const dashboardWsController = bindOmniQueueNestWebSocket(app.getHttpServer(), dashboardOptions);
  app.getHttpServer().once('close', () => {
    dashboardWsController.close();
  });

  await app.listen(3050);
  console.log('Nest example running on http://localhost:3050');
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

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
