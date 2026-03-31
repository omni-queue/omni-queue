# @omni-queue/dashboard

Shadcn-style dashboard UI package for Omni Queue.

## Purpose

This package hosts the dashboard frontend as a workspace package instead of an example-only app. It targets the Supervisor-owned dashboard APIs exposed from `@omni-queue/core`.

## Expected backend endpoints

The UI expects a configurable API base (default: `/api/dashboard`) and uses these endpoints under that base:

- `GET /auth/config`
- `GET /auth/session`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /overview`
- `GET /queues`
- `GET /jobs`
- `GET /workers`
- `GET /completed`
- `GET /failed`
- `GET /archive`
- `GET /slo`
- `GET /stream` (HTTP polling fallback)
- `GET /ws` (WebSocket transport)
- `GET /scaling`
- `POST /scaling`
- `POST /dlq/retry`

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

Open <http://localhost:4173>.

If your dashboard endpoint is customized, set `VITE_DASHBOARD_ENDPOINT` before starting the UI. Example:

```bash
VITE_DASHBOARD_ENDPOINT=/queue-manager npm run dev
```

If your backend runs on a non-default origin/port in local development, set `VITE_API_TARGET` as well. Example (Redis isolation API on port 3100):

```bash
VITE_API_TARGET=http://localhost:3100 npm run dev
```

## Interactive auth

The published dashboard now renders its own login UI. Serve the static assets publicly, then protect only the API and WebSocket routes.

- `basic` auth => username/password form posts to `/auth/login`
- `bearer` + `loginMode: 'token'` => token input posts to `/auth/login`
- `bearer` + `loginMode: 'custom'` => username/password form posts to `/auth/login`

On success, the backend returns the token that the dashboard should use on subsequent API and WebSocket requests.

## Transport mode

By default, the dashboard uses WebSocket with automatic HTTP polling fallback.

For local development (`npm run dev`), you can still force polling at build/dev time:

```bash
VITE_DASHBOARD_TRANSPORT=polling npm run dev
```

For published/built dashboard assets, prefer runtime override (no rebuild needed):

```html
<script>
  window.__OMNI_QUEUE_DASHBOARD_CONFIG__ = {
    transport: 'polling',
  };
</script>
```

You can also use a URL override for troubleshooting: `?transport=polling`.
