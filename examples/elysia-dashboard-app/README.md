# elysia-dashboard-app

Elysia + `@omni-queue/elysia-adapter` dashboard hosting sample.

This example targets Bun runtime (matching the Elysia adapter quickstart).

## Install from npm

```bash
cd examples/elysia-dashboard-app
npm install
```

To publish dashboard assets with the CLI:

```bash
npx @omni-queue/cli dashboard:publish --out=./public/omni-queue-dashboard --base=/secured-dashboard --api-base=/api/dashboard-api
```

## Why worker is a separate script

Do not run queue workers inside the HTTP server process.

- Preserve API responsiveness under heavy background load.
- Scale and deploy worker capacity independently.
- Improve fault isolation.

This sample provides two entrypoints:

- `bun run dev`: API + dashboard host only (`src/server.ts`)
- `bun run worker`: queue worker only (`src/worker.ts`)

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
- `DASHBOARD_UI_DIR`: dashboard static asset directory. Default: `public/omni-queue-dashboard`
- `QUEUE_DATA_DIR`: shared file queue directory. Default: `queue-data`

This sample uses `FileQueueStorage` from `@omni-queue/core` by default so server and worker share the same local storage directory out-of-the-box.
