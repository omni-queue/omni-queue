import express from 'express';
import type { DashboardAuthOptions, QueueAdminJobStatus, Supervisor } from '@vasto/core';
import {
  asNonNegativeInt,
  asPositiveInt,
  asString,
  buildOverview,
  buildSloReport,
  getDashboardBatch,
  getDashboardJobById,
  getDashboardJobs,
  getMonitoringTag,
  getSilencedJobs,
  listDashboardBatches,
  listMonitoringTags,
  queryArchive,
  type DashboardJobFilterStatus,
  updateArchiveRetention,
} from '@vasto/dashboard-api';
import { checkAuth, getAllowedQueues, hasDashboardPermission } from './auth';

function asDashboardStatus(value: unknown): DashboardJobFilterStatus | undefined {
  const status = asString(value);
  if (
    status === 'deferred' ||
    status === 'dlq' ||
    status === 'pending-deferred' ||
    status === 'promoted-deferred' ||
    status === 'ready' ||
    status === 'active' ||
    status === 'completed'
  ) {
    return status;
  }
  return undefined;
}

function asQueueAdminStatus(value: unknown): QueueAdminJobStatus | undefined {
  const status = asString(value);
  if (
    status === 'ready' ||
    status === 'active' ||
    status === 'deferred' ||
    status === 'failed' ||
    status === 'completed' ||
    status === 'all'
  ) {
    return status;
  }
  return undefined;
}

export function buildDashboardRouter(
  supervisor: Supervisor,
  auth: DashboardAuthOptions,
  streamIntervalMs: number
): express.Router {
  const router = express.Router();

  const hasQueueAccess = (req: express.Request, queueName: string): boolean => {
    const allowedQueues = getAllowedQueues(req);
    if (!allowedQueues) return true;
    return allowedQueues.has(queueName);
  };

  const enforceQueueAccess = (
    req: express.Request,
    res: express.Response,
    queueName: string | undefined,
    errorMessage = 'Queue access denied'
  ): queueName is string => {
    if (!queueName) {
      return false;
    }

    if (!hasQueueAccess(req, queueName)) {
      res.status(403).json({ error: errorMessage });
      return false;
    }

    return true;
  };

  const filterOverviewForRequest = async (req: express.Request) => {
    const overview = await buildOverview(supervisor);
    const allowedQueues = getAllowedQueues(req);
    if (!allowedQueues) {
      return overview;
    }

    const filteredQueues = overview.queues.filter((queue) => allowedQueues.has(queue.queue));
    const totals = filteredQueues.reduce(
      (acc, queue) => {
        acc.depth += queue.depth;
        acc.deferred += queue.deferredCount;
        acc.dlq += queue.dlqCount;
        acc.completed += queue.completedCount ?? 0;
        return acc;
      },
      { depth: 0, deferred: 0, dlq: 0, completed: 0 }
    );

    const reliabilityQueues = (overview.reliability?.queues ?? []).filter((queue) =>
      allowedQueues.has(queue.queueName)
    );

    const filteredWorkers = overview.workers.configured
      .map((worker) => ({
        ...worker,
        queues: worker.queues.filter((queueName) => allowedQueues.has(queueName)),
      }))
      .filter((worker) => worker.queues.length > 0);

    return {
      ...overview,
      totals: {
        ...totals,
        load: totals.depth,
      },
      queues: filteredQueues,
      workers: {
        configured: filteredWorkers,
        desiredScaling: Object.fromEntries(
          Object.entries(overview.workers.desiredScaling).filter(([workerName]) =>
            filteredWorkers.some((worker) => worker.name === workerName)
          )
        ),
      },
      reliability: {
        openCircuits: reliabilityQueues.filter((queue) => queue.circuitState === 'open').length,
        halfOpenCircuits: reliabilityQueues.filter((queue) => queue.circuitState === 'half-open').length,
        backpressuredQueues: reliabilityQueues.filter((queue) => queue.backpressureActive).length,
        queues: reliabilityQueues,
      },
    };
  };

  const requirePermission = (
    req: express.Request,
    res: express.Response,
    permission: 'read' | 'operate' | 'admin'
  ): boolean => {
    if (hasDashboardPermission(req, permission)) {
      return true;
    }

    res.status(403).json({ error: 'Insufficient permissions' });
    return false;
  };

  const filterJobsForRequest = <T extends { queue: string }>(req: express.Request, jobs: T[]): T[] => {
    const allowedQueues = getAllowedQueues(req);
    if (!allowedQueues) {
      return jobs;
    }

    return jobs.filter((job) => allowedQueues.has(job.queue));
  };

  router.use(express.json());
  router.use(express.urlencoded({ extended: false }));

  router.use(async (req, res, next) => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    if (await checkAuth(req, res, auth)) next();
  });

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vasto-dashboard' });
  });

  router.get('/overview', async (_req, res) => {
    try {
      if (!requirePermission(_req, res, 'read')) return;
      res.json(await filterOverviewForRequest(_req));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/queues', async (_req, res) => {
    try {
      if (!requirePermission(_req, res, 'read')) return;
      const overview = await filterOverviewForRequest(_req);
      res.json({
        status: 'ok',
        total: overview.queues.length,
        queues: overview.queues,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/queues/:queueName/status', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const queueName = asString(req.params.queueName);
      if (!queueName) {
        res.status(400).json({ error: 'Queue name is required' });
        return;
      }

      if (!enforceQueueAccess(req, res, queueName)) return;

      const status = await supervisor.getQueueStatus(queueName);
      if (!status) {
        res.status(404).json({ error: 'Queue not found' });
        return;
      }

      res.json({ status: 'ok', queue: status });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.post('/queues/:queueName/pause', (req, res) => {
    if (!requirePermission(req, res, 'operate')) return;
    const queueName = asString(req.params.queueName);
    if (!queueName) {
      res.status(400).json({ error: 'Queue name is required' });
      return;
    }

    if (!enforceQueueAccess(req, res, queueName)) return;

    const ok = supervisor.pauseQueue(queueName);
    if (!ok) {
      res.status(404).json({ error: 'Queue not found' });
      return;
    }

    res.status(202).json({ status: 'paused', queueName });
  });

  router.post('/queues/:queueName/resume', (req, res) => {
    if (!requirePermission(req, res, 'operate')) return;
    const queueName = asString(req.params.queueName);
      if (!enforceQueueAccess(req, res, queueName)) return;

    if (!queueName) {
      res.status(400).json({ error: 'Queue name is required' });
      return;
    }

    const ok = supervisor.resumeQueue(queueName);
    if (!ok) {
      res.status(404).json({ error: 'Queue not found' });
      return;
    }

    res.status(202).json({ status: 'resumed', queueName });
  });

  router.post('/queues/:queueName/drain', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'operate')) return;
      const queueName = asString(req.params.queueName);
        if (!enforceQueueAccess(req, res, queueName)) return;

      if (!queueName) {
        res.status(400).json({ error: 'Queue name is required' });
        return;
      }

      const timeoutMs = asPositiveInt(Number(req.body?.timeoutMs)) ?? 30_000;
      const drained = await supervisor.drainQueue(queueName, {
        timeoutMs,
        pauseFirst: true,
      });

      if (!supervisor.getQueueConfig(queueName)) {
        res.status(404).json({ error: 'Queue not found' });
        return;
      }

      if (!drained) {
        res.status(202).json({
          status: 'draining-timeout',
          queueName,
          paused: supervisor.isQueuePaused(queueName),
        });
        return;
      }

      res.status(202).json({
        status: 'drained',
        queueName,
        paused: supervisor.isQueuePaused(queueName),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/workers', async (_req, res) => {
    try {
      if (!requirePermission(_req, res, 'read')) return;
      const overview = await filterOverviewForRequest(_req);
      res.json({
        status: 'ok',
        total: overview.workers.configured.length,
        workers: overview.workers.configured,
        desiredScaling: overview.workers.desiredScaling,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/flows', (_req, res) => {
    try {
      const flows = supervisor.listFlows();
      res.json({ status: 'ok', total: flows.length, flows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/flows/:flowId', (req, res) => {
    try {
      const flowId = asString(req.params.flowId);
      if (!flowId) {
        res.status(400).json({ error: 'Flow id is required' });
        return;
      }

      const flow = supervisor.getFlow(flowId);
      if (!flow) {
        res.status(404).json({ error: 'Flow not found' });
        return;
      }

      res.json({ status: 'ok', flow });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/summary', async (_req, res) => {
    try {
      if (!requirePermission(_req, res, 'read')) return;
      const overview = await filterOverviewForRequest(_req);
      res.json({
        status: 'ok',
        generatedAt: overview.generatedAt,
        load: overview.totals.load ?? overview.totals.depth,
        scheduled: overview.totals.deferred,
        failed: overview.totals.dlq,
        queueCount: overview.queues.length,
        workerCount: overview.workers.configured.length,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/events', (req, res) => {
    if (!requirePermission(req, res, 'read')) return;
    const limit = asPositiveInt(Number(req.query.limit)) ?? 100;
    const allowedQueues = getAllowedQueues(req);
    const events = supervisor
      .getRecentLifecycleEvents(limit)
      .filter((event) => !allowedQueues || !event.queueName || allowedQueues.has(event.queueName));
    res.json({
      status: 'ok',
      total: events.length,
      events,
    });
  });

  router.get('/stream/lifecycle', (req, res) => {
    if (!requirePermission(req, res, 'read')) return;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const allowedQueues = getAllowedQueues(req);
    const replay = supervisor
      .getRecentLifecycleEvents(100)
      .filter((event) => !allowedQueues || !event.queueName || allowedQueues.has(event.queueName));
    for (const event of replay) {
      res.write('event: lifecycle\n');
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const unsubscribe = supervisor.subscribeLifecycleEvents((event) => {
      if (allowedQueues && event.queueName && !allowedQueues.has(event.queueName)) {
        return;
      }
      res.write('event: lifecycle\n');
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on('close', () => {
      unsubscribe();
      res.end();
    });
  });

  router.get('/archive', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const queueName = asString(req.query.queue);
      if (queueName && !enforceQueueAccess(req, res, queueName)) return;
      const jobName = asString(req.query.jobName);
      const search = asString(req.query.search);
      const fromTs = asNonNegativeInt(Number(req.query.fromTs));
      const toTs = asNonNegativeInt(Number(req.query.toTs));
      const limit = asPositiveInt(Number(req.query.limit)) ?? 100;
      const offset = asNonNegativeInt(Number(req.query.offset)) ?? 0;

      const jobs = await queryArchive(supervisor, {
        ...(queueName ? { queueName } : {}),
        ...(jobName ? { jobName } : {}),
        ...(search ? { search } : {}),
        ...(fromTs != null ? { fromTs } : {}),
        ...(toTs != null ? { toTs } : {}),
        limit,
        offset,
      });

      res.json({
        status: 'ok',
        total: filterJobsForRequest(req, jobs).length,
        jobs: filterJobsForRequest(req, jobs),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.post('/archive/retention', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'admin')) return;
      const retentionMs = asPositiveInt(Number(req.body?.retentionMs));
      const maxRowsPerQueue = asPositiveInt(Number(req.body?.maxRowsPerQueue));

      if (retentionMs == null && maxRowsPerQueue == null) {
        res.status(400).json({
          error: 'Provide at least one retention setting: retentionMs or maxRowsPerQueue',
        });
        return;
      }

      updateArchiveRetention(supervisor, {
        ...(retentionMs != null ? { retentionMs } : {}),
        ...(maxRowsPerQueue != null ? { maxRowsPerQueue } : {}),
      });

      res.json({
        status: 'ok',
        message: 'Archive retention policy updated',
        policy: {
          ...(retentionMs != null ? { retentionMs } : {}),
          ...(maxRowsPerQueue != null ? { maxRowsPerQueue } : {}),
        },
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/batches', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const limit = Number(req.query.limit ?? '100');
      const offset = Number(req.query.offset ?? '0');
      const batches = await listDashboardBatches(supervisor, { limit, offset });

      res.json({
        status: 'ok',
        total: batches.length,
        batches,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/monitoring', async (_req, res) => {
    try {
      if (!requirePermission(_req, res, 'read')) return;
      const allowedQueues = getAllowedQueues(_req);
      const tags = await listMonitoringTags(supervisor, {
        ...(allowedQueues ? { queueNames: [...allowedQueues] } : {}),
      });
      res.json({ status: 'ok', total: tags.length, tags });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/monitoring/:tag', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const tag = asString(req.params.tag);
      if (!tag) {
        res.status(400).json({ error: 'Tag is required' });
        return;
      }

      const allowedQueues = getAllowedQueues(req);
      const summary = await getMonitoringTag(supervisor, tag, {
        ...(allowedQueues ? { queueNames: [...allowedQueues] } : {}),
      });
      if (!summary) {
        res.status(404).json({ error: 'Tag not found' });
        return;
      }

      res.json({ status: 'ok', tag: summary });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/slo', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;

      const queueName = asString(req.query.queue);
      if (queueName && !enforceQueueAccess(req, res, queueName)) return;

      const requestedWindow = asPositiveInt(Number(req.query.windowMs));
      const windowMs = Math.min(Math.max(requestedWindow ?? 60 * 60_000, 60_000), 7 * 24 * 60 * 60_000);
      const allowedQueues = getAllowedQueues(req);
      const report = await buildSloReport(supervisor, {
        windowMs,
        ...(queueName ? { queueNames: [queueName] } : {}),
        ...(allowedQueues ? { allowedQueues } : {}),
      });

      res.json({
        status: 'ok',
        slo: report,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/batches/:batchId', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const batchId = asString(req.params.batchId);
      if (!batchId) {
        res.status(400).json({ error: 'Batch id is required' });
        return;
      }

      const batch = await getDashboardBatch(supervisor, batchId);
      if (!batch) {
        res.status(404).json({ error: 'Batch not found' });
        return;
      }

      res.json({ status: 'ok', batch });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.post('/batches/:batchId/retry-failed', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'operate')) return;
      const batchId = asString(req.params.batchId);
      if (!batchId) {
        res.status(400).json({ error: 'Batch id is required' });
        return;
      }

      const retried = await supervisor.retryFailedBatchJobs(batchId);
      res.status(202).json({ status: 'retried', batchId, retried });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/jobs', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const queueName = asString(req.query.queue);
      if (queueName && !enforceQueueAccess(req, res, queueName)) return;
      const status = asDashboardStatus(req.query.status);
      const limit = Number(req.query.limit ?? '100');
      const offset = Number(req.query.offset ?? '0');

      const result = await getDashboardJobs(supervisor, {
        ...(queueName && { queueName }),
        ...(status && { status }),
        limit,
        offset,
      });

      const filteredJobs = filterJobsForRequest(req, result.jobs);
      res.json({
        status: 'ok',
        mode: result.mode,
        total: filteredJobs.length,
        jobs: filteredJobs,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/failed', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const queueName = asString(req.query.queue);
      if (queueName && !enforceQueueAccess(req, res, queueName)) return;
      const limit = Number(req.query.limit ?? '100');
      const offset = Number(req.query.offset ?? '0');

      const result = await getDashboardJobs(supervisor, {
        ...(queueName && { queueName }),
        status: 'dlq',
        limit,
        offset,
      });

      const filteredJobs = filterJobsForRequest(req, result.jobs);
      res.json({
        status: 'ok',
        mode: result.mode,
        total: filteredJobs.length,
        jobs: filteredJobs,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/ready', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const queueName = asString(req.query.queue);
      if (queueName && !enforceQueueAccess(req, res, queueName)) return;
      const limit = Number(req.query.limit ?? '100');
      const offset = Number(req.query.offset ?? '0');

      const result = await getDashboardJobs(supervisor, {
        ...(queueName && { queueName }),
        status: 'ready',
        limit,
        offset,
      });

      const filteredJobs = filterJobsForRequest(req, result.jobs);
      res.json({
        status: 'ok',
        mode: result.mode,
        total: filteredJobs.length,
        jobs: filteredJobs,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/active', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const queueName = asString(req.query.queue);
      if (queueName && !enforceQueueAccess(req, res, queueName)) return;
      const limit = Number(req.query.limit ?? '100');
      const offset = Number(req.query.offset ?? '0');

      const result = await getDashboardJobs(supervisor, {
        ...(queueName && { queueName }),
        status: 'active',
        limit,
        offset,
      });

      const filteredJobs = filterJobsForRequest(req, result.jobs);
      res.json({
        status: 'ok',
        mode: result.mode,
        total: filteredJobs.length,
        jobs: filteredJobs,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/processed', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const queueName = asString(req.query.queue);
      if (queueName && !enforceQueueAccess(req, res, queueName)) return;
      const limit = Number(req.query.limit ?? '100');
      const offset = Number(req.query.offset ?? '0');

      const result = await getDashboardJobs(supervisor, {
        ...(queueName && { queueName }),
        status: 'completed',
        limit,
        offset,
      });

      const filteredJobs = filterJobsForRequest(req, result.jobs);
      res.json({
        status: 'ok',
        mode: result.mode,
        total: filteredJobs.length,
        jobs: filteredJobs,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/completed', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const queueName = asString(req.query.queue);
      if (queueName && !enforceQueueAccess(req, res, queueName)) return;
      const limit = Number(req.query.limit ?? '100');
      const offset = Number(req.query.offset ?? '0');

      const result = await getDashboardJobs(supervisor, {
        ...(queueName && { queueName }),
        status: 'completed',
        limit,
        offset,
      });

      const filteredJobs = filterJobsForRequest(req, result.jobs);
      res.json({
        status: 'ok',
        mode: result.mode,
        total: filteredJobs.length,
        jobs: filteredJobs,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/silenced', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const queueName = asString(req.query.queue);
      if (queueName && !enforceQueueAccess(req, res, queueName)) return;
      const limit = Number(req.query.limit ?? '100');
      const offset = Number(req.query.offset ?? '0');

      const result = await getSilencedJobs(supervisor, {
        ...(queueName && { queueName }),
        limit,
        offset,
      });

      const filteredJobs = filterJobsForRequest(req, result.jobs);
      res.json({
        status: 'ok',
        mode: result.mode,
        total: filteredJobs.length,
        jobs: filteredJobs,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/jobs/:jobId', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'read')) return;
      const jobId = asString(req.params.jobId);
      const queueName = asString(req.query.queue);

      if (!jobId) {
        res.status(400).json({ error: 'Job id is required' });
        return;
      }

      if (queueName && !enforceQueueAccess(req, res, queueName)) return;

      const result = await getDashboardJobById(supervisor, jobId, queueName);
      if (!result) {
        res.status(404).json({ error: 'Job not found in ready, running, scheduled, completed, or failed storage' });
        return;
      }

      if (!hasQueueAccess(req, result.job.queue)) {
        res.status(404).json({ error: 'Job not found in ready, running, scheduled, completed, or failed storage' });
        return;
      }

      res.json({ status: 'ok', source: result.source, job: result.job });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.post('/jobs/:jobId/promote', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'operate')) return;
      const jobId = asString(req.params.jobId);
      const queueName = asString(req.body?.queueName ?? req.query.queueName);
  if (!enforceQueueAccess(req, res, queueName)) return;


      if (!jobId || !queueName) {
        res.status(400).json({ error: 'Expected queueName and jobId' });
        return;
      }

      const promoted = await supervisor.promoteJob(queueName, jobId);
      if (!promoted) {
        res.status(404).json({ error: 'Promotable deferred job not found' });
        return;
      }

      res.status(202).json({ status: 'promoted', queueName, jobId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.delete('/jobs/:jobId', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'operate')) return;
      const jobId = asString(req.params.jobId);
      const queueName = asString(req.query.queueName ?? req.body?.queueName);
  if (!enforceQueueAccess(req, res, queueName)) return;


      if (!jobId || !queueName) {
        res.status(400).json({ error: 'Expected queueName and jobId' });
        return;
      }

      const removed = await supervisor.removeJob(queueName, jobId);
      if (!removed) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      res.status(202).json({ status: 'removed', queueName, jobId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.post('/queues/:queueName/clean', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'operate')) return;
      const queueName = asString(req.params.queueName);
        if (!enforceQueueAccess(req, res, queueName)) return;

      if (!queueName) {
        res.status(400).json({ error: 'Queue name is required' });
        return;
      }

      const status = asQueueAdminStatus(req.body?.status);
      const graceMs = asNonNegativeInt(Number(req.body?.graceMs)) ?? 0;
      const limit = asPositiveInt(Number(req.body?.limit)) ?? 1000;

      const removed = await supervisor.cleanJobs(queueName, {
        ...(status ? { status } : {}),
        graceMs,
        limit,
      });

      res.status(202).json({
        status: 'cleaned',
        queueName,
        removed,
        criteria: {
          status: status ?? 'all',
          graceMs,
          limit,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.post('/queues/:queueName/obliterate', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'operate')) return;
      const queueName = asString(req.params.queueName);
        if (!enforceQueueAccess(req, res, queueName)) return;

      if (!queueName) {
        res.status(400).json({ error: 'Queue name is required' });
        return;
      }

      const removed = await supervisor.obliterateQueue(queueName);
      res.status(202).json({ status: 'obliterated', queueName, removed });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.post('/dlq/retry', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'operate')) return;
      const queueName = asString(req.body?.queueName);
      const jobId = asString(req.body?.jobId);
  if (!enforceQueueAccess(req, res, queueName)) return;


      if (!queueName || !jobId) {
        res.status(400).json({ error: 'Expected payload: { queueName, jobId }' });
        return;
      }

      const retried = await supervisor.retryDLQ(queueName, jobId);
      if (!retried) {
        res.status(404).json({ error: 'Dead-letter job not found' });
        return;
      }

      res.status(202).json({ status: 'retried', queueName, jobId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.post('/failed/retry', async (req, res) => {
    try {
      if (!requirePermission(req, res, 'operate')) return;
      const queueName = asString(req.body?.queueName);
      const jobId = asString(req.body?.jobId);
  if (!enforceQueueAccess(req, res, queueName)) return;


      if (!queueName || !jobId) {
        res.status(400).json({ error: 'Expected payload: { queueName, jobId }' });
        return;
      }

      const retried = await supervisor.retryDLQ(queueName, jobId);
      if (!retried) {
        res.status(404).json({ error: 'Failed job not found' });
        return;
      }

      res.status(202).json({ status: 'retried', queueName, jobId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
    }
  });

  router.get('/scaling', (_req, res) => {
    if (!requirePermission(_req, res, 'read')) return;
    res.json({ status: 'ok', desiredScaling: supervisor.getDesiredWorkerScaling() });
  });

  router.post('/scaling', (req, res) => {
    if (!requirePermission(req, res, 'admin')) return;
    const workerName = asString(req.body?.workerName);
    const concurrency = asPositiveInt(req.body?.concurrency);

    if (
      !workerName ||
      concurrency === undefined ||
      !Object.hasOwn(supervisor.getWorkerDefinitions(), workerName)
    ) {
      res.status(400).json({ error: 'Expected payload: { workerName, concurrency }' });
      return;
    }

    supervisor.setWorkerScaling(workerName, concurrency);
    res.status(202).json({
      status: 'updated',
      desiredScaling: supervisor.getDesiredWorkerScaling(),
    });
  });

  router.get('/stream', async (req, res) => {
    if (!requirePermission(req, res, 'read')) return;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const send = async () => {
      const overview = await filterOverviewForRequest(req);
      res.write('event: overview\n');
      res.write(`data: ${JSON.stringify(overview)}\n\n`);
    };

    await send();
    const timer = setInterval(() => {
      void send();
    }, streamIntervalMs);

    req.on('close', () => {
      clearInterval(timer);
      res.end();
    });
  });

  return router;
}
