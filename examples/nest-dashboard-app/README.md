# nest-dashboard-app

Nest + `@omni-queue/nest-adapter` dashboard hosting sample.

## Install from npm

```bash
cd examples/nest-dashboard-app
npm install
```

To publish dashboard assets with the CLI:

```bash
npx @omni-queue/cli dashboard:publish --out=./public/omni-queue-dashboard --base=/secured-dashboard --api-base=/api/dashboard-api
```

## Why worker is a separate script in production

For production, keep queue workers outside the HTTP server process.

- API availability and job execution lifecycles should be decoupled.
- Worker replicas and server replicas usually scale on different signals.
- Operationally safer crash and rollout boundaries.

This sample provides two entrypoints:

- `npm run dev`: API + dashboard host + worker in one process (`src/main.ts`, `SUPERVISOR_MODE=hybrid` by default)
- `npm run worker`: queue worker only (`src/worker.ts`)

## Optional same-process mode

Same-process mode is enabled by default. You can still set it explicitly:

```bash
SUPERVISOR_MODE=hybrid npm run dev
```

In that mode, `src/main.ts` starts the supervisor with `start('hybrid')` and registers an inline worker for the `emails` queue. This is useful for local development or small deployments, but it is still not the default recommendation for production.

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

- `DASHBOARD_API_BASE`: dashboard API mount path. Default: `/api/dashboard-api`
- `DASHBOARD_UI_BASE`: dashboard UI mount path. Default: `/secured-dashboard`
- `DASHBOARD_UI_DIR`: dashboard static asset directory. Default: `public/omni-queue-dashboard`
- `QUEUE_DATA_DIR`: shared file queue directory. Default: `queue-data`
- `RECOVER_REPEATABLES`: default `false` in this example. Set to `true` only when you intentionally want persisted interval/cron schedules to recover on startup.

This sample uses `FileQueueStorage` from `@omni-queue/core` by default so server and worker share the same local storage directory out-of-the-box.

If you see jobs enqueueing every few seconds in hybrid mode, old persisted repeatable schedules are likely present in `queue-data`. This sample disables repeatable recovery on startup by default (`RECOVER_REPEATABLES=false`), so those definitions are ignored unless you explicitly opt in.
