# elysia-dashboard-app

Elysia + `@vasto-queue/elysia-adapter` dashboard hosting sample.

This example targets Bun runtime (matching the Elysia adapter quickstart).

## Install from npm

```bash
cd examples/elysia-dashboard-app
npm install
```

To publish dashboard assets with the CLI:

```bash
npx @vasto-queue/cli dashboard:publish --out=./public/vasto-dashboard --base=/secured-dashboard --api-base=/api/dashboard-api
```

## Why worker is a separate script in production

For production, keep queue workers outside the HTTP server process.

- Preserve API responsiveness under heavy background load.
- Scale and deploy worker capacity independently.
- Improve fault isolation.

This sample provides two entrypoints:

- `bun run dev`: API + dashboard host + worker in one process (`src/server.ts`, `SUPERVISOR_MODE=hybrid` by default)
- `bun run worker`: queue worker only (`src/worker.ts`)

## Optional same-process mode

Same-process mode is enabled by default. You can still set it explicitly:

```bash
SUPERVISOR_MODE=hybrid bun run dev
```

In that mode, `src/server.ts` starts the supervisor with `start('hybrid')` and registers an inline worker for the `emails` queue. This is useful for local development or small deployments, but it is still not the default recommendation for production.

## API-only mode

If you want the split-process setup:

```bash
SUPERVISOR_MODE=api bun run dev
bun run worker
```

In API-only mode, the server will enqueue jobs but will not process them itself.

## Run

Terminal 1 (server):

```bash
bun run dev
```

Terminal 2 (worker):

```bash
bun run worker
```

## Configuration

- `DASHBOARD_API_BASE`: dashboard API mount path. Default: `/api/dashboard-api`
- `DASHBOARD_UI_BASE`: dashboard UI mount path. Default: `/secured-dashboard`
- `DASHBOARD_UI_DIR`: dashboard static asset directory. Default: `public/vasto-dashboard`
- `QUEUE_DATA_DIR`: shared file queue directory. Default: `queue-data`
- `RECOVER_REPEATABLES`: default `false` in this example. Set to `true` only when you intentionally want persisted interval/cron schedules to recover on startup.

This sample uses `FileQueueStorage` from `@vasto-queue/core` by default so server and worker share the same local storage directory out-of-the-box.

If you see jobs enqueueing every few seconds in hybrid mode, old persisted repeatable schedules are likely present in `queue-data`. This sample disables repeatable recovery on startup by default (`RECOVER_REPEATABLES=false`), so those definitions are ignored unless you explicitly opt in.
