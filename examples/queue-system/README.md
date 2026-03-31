# queue-system

In-memory Omni Queue example demonstrating multi-queue processing, plugins, and dashboard integration.

## What this example includes

- Multiple queues: `emails`, `reports`, `maintenance`
- Worker isolation via thread runtime modules
- Built-in plugins (`DAGPlugin`, `RateLimiterPlugin`) + OTel tracing plugin
- Dashboard API + WebSocket mounting through `@omni-queue/express-adapter`

## Prerequisites

From the repository root:

```bash
npm install
npm run build
```

## Run the server

```bash
cd examples/queue-system
npm run server:dev
```

Server defaults:

- API: `http://localhost:3110`
- Dashboard API base: `/api/dashboard`

## Start dashboard UI (optional)

In a separate terminal:

```bash
cd packages/dashboard
npm run dev
```

Open `http://localhost:4173`.

## Health check

```bash
curl http://localhost:3110/health
```

## Notes

- Dashboard WebSocket updates are enabled by default.
- The process supports graceful shutdown on `Ctrl+C` (closes websocket/server handles and stops workers).