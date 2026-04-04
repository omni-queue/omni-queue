/**
 * API Server — receives HTTP requests and dispatches jobs to the queue.
 *
 * Run this in one terminal:  npm run server
 * Run the worker in another: npm run worker
 *
 * Both processes share the same queue via the filesystem (./queue-data/).
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  JobManager,
  JobRegistry,
  defineQueues,
  defineWorkers,
} from '@vasto/core';
import { FileQueueStorage } from './storage/file-queue-storage.js';
import { SendEmailJob } from './jobs/index.js';

type EmailRequestBody = {
  to?: string;
  subject?: string;
  body?: string;
};

async function readJsonBody(req: http.IncomingMessage): Promise<EmailRequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as EmailRequestBody;
}

async function main() {
  const port = Number(process.env.PORT ?? '3000');
  const dataDir = process.env.QUEUE_DATA_DIR ?? './queue-data';

  // ── Queue plumbing ──────────────────────────────────────────────────────────
  // The server only *dispatches* jobs — it never executes them.
  // The worker process (worker.ts) owns execution via the Supervisor.

  const registry = new JobRegistry();
  registry.registerAll([SendEmailJob]);

  const queues = defineQueues({
    'api-jobs': {
      name: 'api-jobs',
      connection: 'disk',
      concurrency: 4,
      batchSize: 10,
    },
  });

  const workers = defineWorkers({
    apiRunner: {
      queues: ['api-jobs'],
      concurrency: 4,
      isolation: 'inline',
    },
  });

  const storageAdapters = {
    disk: new FileQueueStorage(dataDir),
  };

  // JobManager is used for dispatch() only — no Supervisor here.
  const jobManager = new JobManager(queues, workers, registry, storageAdapters);

  // ── HTTP Server ─────────────────────────────────────────────────────────────

  const server = http.createServer(async (req, res) => {
    try {
      // GET /health
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', pid: process.pid }));
        return;
      }

      // POST /jobs/email  — enqueue a send-email job
      if (req.method === 'POST' && req.url === '/jobs/email') {
        const requestId = randomUUID();
        const body = await readJsonBody(req);

        const to = body.to?.trim();
        const subject = body.subject?.trim();
        const content = body.body?.trim();

        if (!to || !subject || !content) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Expected body: { to, subject, body }',
              requestId,
            })
          );
          return;
        }

        await jobManager.dispatch(new SendEmailJob({ to, subject, body: content }));

        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'queued',
            requestId,
            jobName: SendEmailJob.jobName,
            queue: 'api-jobs',
          })
        );
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' })
      );
    }
  });

  server.listen(port, () => {
    console.log(`[server] API server listening on http://localhost:${port}`);
    console.log(`[server] Queue data directory: ${dataDir}`);
    console.log(`[server] POST /jobs/email   — dispatch a SendEmailJob`);
    console.log(`[server] GET  /health       — health check`);
  });

  const shutdown = () => {
    console.log('\n[server] Shutting down...');
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] Fatal:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
