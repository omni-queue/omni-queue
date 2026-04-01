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

## Why worker is a separate script

Do not run queue workers inside the HTTP server process.

- Keep request latency predictable (job execution can be CPU/IO heavy).
- Scale API servers and workers independently.
- Isolate failures so a bad job cannot take down the web process.
- Use separate deployment/runtime policies for background work.

This sample provides two entrypoints:

- `npm run dev`: API + dashboard host only (`src/server.ts`)
- `npm run worker`: queue worker only (`src/worker.ts`)

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
