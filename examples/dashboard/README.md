# dashboard example

This example is now superseded by the workspace package at `packages/dashboard`.

Shadcn-based dashboard UI for omni-queue.

## Features

- Queue overview & health cards
- Job browser with filtering (deferred + DLQ)
- Failed job triage & retry actions
- Real-time updates via SSE (`/dashboard/stream`)
- Worker scaling controls (desired concurrency API)

## Prerequisites

Run the Redis isolation API backend first:

```bash
cd examples/redis-isolation
npm run server
```

The dashboard proxies API requests to `http://localhost:3100` by default.

## Run dashboard

```bash
cd packages/dashboard
npm run dev
```

Then open:

- http://localhost:4173

## Backend endpoints used

- `GET /dashboard/overview`
- `GET /dashboard/jobs`
- `GET /dashboard/stream` (SSE)
- `GET /dashboard/scaling`
- `POST /dashboard/scaling`
- `POST /dashboard/dlq/retry`
