# api-server example

Demonstrates the canonical vasto deployment pattern:

- **API Server** — an HTTP process that accepts requests and *dispatches* jobs to the queue.
- **Queue Worker** — a separate process running the `Supervisor` that *picks up and executes* jobs.

Both processes share the same **file-based queue storage** (`./queue-data/`).  
No Redis or external broker required — just the filesystem — similar to how Laravel Horizon
works with its various queue drivers (File / Database / Redis).

```
┌───────────────────────────────┐        ┌──────────────────────────────────────────┐
│  API Server  (npm run server) │        │  Queue Worker  (npm run worker)           │
│                               │        │                                           │
│  POST /jobs/email             │        │  Supervisor                               │
│    └─ runtime.dispatch()      │        │    └─ ResilientWorker polls queue-data    │
│         └─ FileQueueStorage   │──────▶ │         └─ WorkerRuntime.execute()        │
│              writes to disk   │        │              runs job handler             │
└───────────────────────────────┘        └──────────────────────────────────────────┘
              queue-data/queued/    queue-data/leased/    queue-data/dead/
```

## Getting started

### Terminal 1 — start the queue worker

```bash
cd examples/api-server
npm run worker
```

```
[worker] Queue worker starting (pid 12345)
[worker] Queue data directory: ./queue-data
[worker] Watching queues: api-jobs
[worker] Press Ctrl+C to stop.
```

### Terminal 2 — start the API server

```bash
cd examples/api-server
npm run server
```

```
[server] API server listening on http://localhost:3000
[server] POST /jobs/email   — dispatch a SendEmailJob
[server] GET  /health       — health check
```

### Dispatch a job via HTTP

```bash
curl -X POST http://localhost:3000/jobs/email \
  -H 'content-type: application/json' \
  -d '{"to":"user@example.com","subject":"Welcome","body":"Hello from vasto!"}'
```

Response:

```json
{ "status": "queued", "requestId": "...", "jobName": "ApiSendEmailJob", "queue": "api-jobs" }
```

The **worker** terminal will log:

```
[ApiSendEmailJob] sending email to user@example.com: Welcome
```

## Endpoints

| Method | Path         | Description                  |
|--------|--------------|------------------------------|
| GET    | `/health`    | Health check (returns pid)   |
| POST   | `/jobs/email`| Dispatch a `SendEmailJob`    |

## Horizontal scaling

Run multiple workers — `fs.renameSync` provides atomic job claiming so workers
safely share the same `./queue-data/` directory without double-processing:

```bash
npm run worker &   # worker 1
npm run worker &   # worker 2
```

Custom data directory:

```bash
QUEUE_DATA_DIR=/var/queue npm run server
QUEUE_DATA_DIR=/var/queue npm run worker
```

## Scripts

| Script              | What it does                                    |
|---------------------|-------------------------------------------------|
| `npm run build`     | Compile TypeScript → `dist/`                    |
| `npm run server`    | Build + start the HTTP API server               |
| `npm run worker`    | Build + start the queue worker / supervisor     |
| `npm run dev:server`| Alias for `server`                              |
| `npm run dev:worker`| Start worker without rebuilding                 |

## Project structure

```
src/
  server.ts                  HTTP API server — dispatches jobs only, no execution
  worker.ts                  Supervisor — executes jobs, never handles HTTP
  jobs/
    send-email.job.ts        Job definition
    index.ts                 Barrel export
  storage/
    file-storage.ts    Cross-process file-based QueueStorage adapter
```
