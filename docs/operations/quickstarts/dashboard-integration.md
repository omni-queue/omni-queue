# Dashboard Integration Guide

Use this guide to run, mount, and operate the Omni Queue dashboard across example apps and adapters.

## When to use this guide

- You want to host dashboard API + UI from your application server.
- You need a local development workflow with live queue visibility.
- You want a predictable path for custom `apiBase` and `uiBase` mounts.

## Recommended integration patterns

### Pattern A: Adapter-hosted dashboard (recommended)

Use framework adapter examples that mount dashboard API routes and serve static dashboard assets from your app process.

Available examples:

- `examples/hono-dashboard-app`
- `examples/fastify-dashboard-app`
- `examples/elysia-dashboard-app`
- `examples/nest-dashboard-app`
- `examples/next-dashboard-app`

Each example follows the same process split:

- `npm run dev`: API + dashboard host process
- `npm run worker`: worker-only process

This keeps API lifecycle and worker lifecycle decoupled.

### Pattern B: Standalone dashboard dev UI against an API target

Use `packages/dashboard` in local UI development mode and point it at a running API server.

```bash
cd packages/dashboard
VITE_API_TARGET=http://localhost:3100 npm run dev
```

Then open `http://localhost:4173`.

## Quick start

### 1) Publish dashboard assets

Generate static dashboard files into your app's public directory:

```bash
npx @omni-queue/cli dashboard:publish --out=./public/omni-queue-dashboard --base=/secured-dashboard --api-base=/api/dashboard-api
```

Use values matching your adapter mount configuration.

### 2) Run server and worker

Example (Hono adapter app):

```bash
cd examples/hono-dashboard-app
npm install
npm run dev
```

In another terminal:

```bash
cd examples/hono-dashboard-app
npm run worker
```

### 3) Open dashboard

- App: `http://localhost:3040`
- UI: `http://localhost:3040/secured-dashboard`
- API base: `http://localhost:3040/api/dashboard-api`

## Configuration contract

Common environment variables used by adapter examples:

- `DASHBOARD_API_BASE`: dashboard API mount path (default `/api/dashboard-api`)
- `DASHBOARD_UI_BASE`: dashboard UI mount path (default `/secured-dashboard`)
- `DASHBOARD_UI_DIR`: static asset directory (default `public/omni-queue-dashboard`)
- `QUEUE_DATA_DIR`: local shared storage directory for server/worker (default `queue-data`)

## Runtime UI config (no rebuild required)

You can override transport and endpoint via host-page runtime config:

```html
<script>
  window.__OMNI_QUEUE_DASHBOARD_CONFIG__ = {
    transport: 'polling',
    endpoint: '/api/dashboard-api',
    uiBase: '/secured-dashboard',
  };
</script>
```

Supported transport values:

- `auto` (default): WebSocket preferred, polling fallback
- `polling`: force polling mode

## Troubleshooting

### Dashboard does not load

1. Verify app server is running and reachable.
2. Verify `apiBase` and `uiBase` values match published dashboard config.
3. Check browser network tab for failed dashboard API calls.

### Live updates are not appearing

1. Verify WebSocket upgrades are allowed by your local proxy/runtime.
2. Test polling mode via runtime config (`transport: 'polling'`).
3. Confirm worker process is running (`npm run worker`) and processing jobs.

### Jobs are queued but not processed

1. Ensure server uses `start('api')` and worker uses `start('worker')`.
2. Ensure both processes share the same `QUEUE_DATA_DIR` in local file-storage examples.
3. Verify queue names in dispatched jobs match worker queue bindings.

## Package boundaries

- `@omni-queue/dashboard-api`: shared API/auth/websocket primitives used by framework adapters.
- `@omni-queue/dashboard`: frontend UI package.
- Adapter packages (`@omni-queue/*-adapter`): framework-specific integration layer.

Queue runtime semantics remain in `@omni-queue/core`.
