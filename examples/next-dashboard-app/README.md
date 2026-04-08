# next-dashboard-app

Next.js + `@vasto-queue/next-adapter` dashboard hosting sample.

## Install from npm

```bash
cd examples/next-dashboard-app
npm install
```

To publish dashboard assets with the CLI:

```bash
npx @vasto-queue/cli dashboard:publish --out=./public/vasto-dashboard --base=/api/dashboard-api --api-base=/api/dashboard-api
```

## Note

This Pages Router sample hosts the dashboard through API routes, so its UI mount is constrained by the API route path unless you add rewrites or run a custom Node server. The preferred sample path is `/api/dashboard-api`.

## Why worker is a separate script in production

For production, keep queue workers outside the Next API process.

- API latency and background execution should be isolated.
- You can scale Next and workers independently.
- Worker failures are isolated from web request handling.

This sample provides two entrypoints:

- `npm run dev`: Next API + dashboard host + worker in one process (`SUPERVISOR_MODE=hybrid` by default)
- `npm run worker`: queue worker only (`src/worker.ts`)

## Optional same-process mode

Same-process mode is enabled by default. You can still set it explicitly:

```bash
SUPERVISOR_MODE=hybrid npm run dev
```

In that mode, `src/runtime.ts` starts the supervisor with `start('hybrid')` and registers an inline worker for the `emails` queue. This is useful for local development or small deployments, but it is still not the default recommendation for production.

## API-only mode

If you want the split-process setup:

```bash
SUPERVISOR_MODE=api npm run dev
npm run worker
```

In API-only mode, the Next process will enqueue jobs but will not process them itself.

## Run

Terminal 1 (server):

```bash
npm run dev
```

Terminal 2 (worker):

```bash
npm run worker
```

## Key files

- `pages/api/dashboard-api/[...dashboard-api].ts`
- `pages/api/jobs/email.ts`
- `src/runtime.ts`

## Configuration

- `QUEUE_DATA_DIR`: shared file queue directory. Default: `queue-data`
- `RECOVER_REPEATABLES`: default `false` in this example. Set to `true` only when you intentionally want persisted interval/cron schedules to recover on startup.

This sample uses `FileQueueStorage` from `@vasto-queue/core` by default so server and worker share the same local storage directory out-of-the-box.

If you see jobs enqueueing every few seconds in hybrid mode, old persisted repeatable schedules are likely present in `queue-data`. This sample disables repeatable recovery on startup by default (`RECOVER_REPEATABLES=false`), so those definitions are ignored unless you explicitly opt in.
