# next-dashboard-app

Next.js + `@omni-queue/next-adapter` dashboard hosting sample.

## Install from npm

```bash
cd examples/next-dashboard-app
npm install
```

To publish dashboard assets with the CLI:

```bash
npx @omni-queue/cli dashboard:publish --out=./public/omni-queue-dashboard --base=/api/dashboard-api --api-base=/api/dashboard-api
```

## Note

This Pages Router sample hosts the dashboard through API routes, so its UI mount is constrained by the API route path unless you add rewrites or run a custom Node server. The preferred sample path is `/api/dashboard-api`.

## Why worker is a separate script

Do not run queue workers inside the Next API process.

- API latency and background execution should be isolated.
- You can scale Next and workers independently.
- Worker failures are isolated from web request handling.

This sample provides two entrypoints:

- `npm run dev`: Next API + dashboard host only
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

## Key files

- `pages/api/dashboard-api/[...dashboard-api].ts`
- `pages/api/jobs/email.ts`
- `src/runtime.ts`

## Configuration

- `QUEUE_DATA_DIR`: shared file queue directory. Default: `queue-data`

This sample uses `FileQueueStorage` from `@omni-queue/core` by default so server and worker share the same local storage directory out-of-the-box.
