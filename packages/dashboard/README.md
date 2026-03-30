# @omni-queue/dashboard

Shadcn-style dashboard UI package for Omni Queue.

## Purpose

This package hosts the dashboard frontend as a workspace package instead of an example-only app. It targets the Supervisor-owned dashboard APIs exposed from `@omni-queue/core`.

## Expected backend endpoints

- `GET /dashboard/overview`
- `GET /dashboard/jobs`
- `GET /dashboard/stream`
- `GET /dashboard/scaling`
- `POST /dashboard/scaling`
- `POST /dashboard/dlq/retry`

## Local development

Start a worker with dashboard enabled, for example from the Redis isolation example:

```bash
cd examples/redis-isolation
DASHBOARD_ENABLED=true npm run worker
```

Then start this UI package:

```bash
cd packages/dashboard
npm run dev
```

Open http://localhost:4173.

If your dashboard endpoint is customized, set `VITE_DASHBOARD_ENDPOINT` before starting the UI. Example:

```bash
VITE_DASHBOARD_ENDPOINT=/queue-manager npm run dev
```
