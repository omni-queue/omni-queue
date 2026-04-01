# hono-dashboard-app

Hono + `@omni-queue/hono-adapter` dashboard hosting sample.

## Install from npm

```bash
cd examples/hono-dashboard-app
npm install
```

To publish dashboard assets with the CLI:

```bash
npx @omni-queue/cli dashboard:publish --out=./public/omni-queue-dashboard --base=/secured-dashboard --api-base=/api/dashboard-api
```

## Why worker is a separate script in production

For production, keep queue workers outside the HTTP server process.

- Keep request latency predictable (job execution can be CPU/IO heavy).
- Scale API servers and workers independently.
- Isolate failures so a bad job cannot take down the web process.
- Use separate deployment/runtime policies for background work.

This sample provides two entrypoints:

- `npm run dev`: API + dashboard host + worker in one process (`src/server.ts`, `SUPERVISOR_MODE=hybrid` by default)
- `npm run worker`: queue worker only (`src/worker.ts`)

## Optional same-process mode

Same-process mode is enabled by default. You can still set it explicitly:

```bash
SUPERVISOR_MODE=hybrid npm run dev
```

In that mode, `src/server.ts` starts the supervisor with `start('hybrid')` and registers an inline worker for the `emails` queue. This is useful for local development or small deployments, but it is still not the default recommendation for production.

## API-only mode

If you want the split-process setup:

```bash
SUPERVISOR_MODE=api npm run dev
npm run worker
```

In API-only mode, the server will enqueue jobs but will not process them itself.

## Run

Terminal 1 (server):

```bash
npm run dev
```

Terminal 2 (worker):

```bash
npm run worker
```

## Configuration

- `DASHBOARD_API_BASE`: default `/api/dashboard-api`
- `DASHBOARD_UI_BASE`: default `/secured-dashboard`
- `DASHBOARD_UI_DIR`: default `public/omni-queue-dashboard`
- `QUEUE_DATA_DIR`: default `queue-data`

This sample uses `FileQueueStorage` from `@omni-queue/core` by default so server and worker share the same local storage directory out-of-the-box.
