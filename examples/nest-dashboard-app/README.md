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

## Why worker is a separate script

Do not run queue workers inside the HTTP server process.

- API availability and job execution lifecycles should be decoupled.
- Worker replicas and server replicas usually scale on different signals.
- Operationally safer crash and rollout boundaries.

This sample provides two entrypoints:

- `npm run dev`: API + dashboard host only (`src/main.ts`)
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

- `DASHBOARD_API_BASE`: dashboard API mount path. Default: `/api/dashboard-api`
- `DASHBOARD_UI_BASE`: dashboard UI mount path. Default: `/secured-dashboard`
- `DASHBOARD_UI_DIR`: dashboard static asset directory. Default: `public/omni-queue-dashboard`
- `QUEUE_DATA_DIR`: shared file queue directory. Default: `queue-data`

This sample uses `FileQueueStorage` from `@omni-queue/core` by default so server and worker share the same local storage directory out-of-the-box.
