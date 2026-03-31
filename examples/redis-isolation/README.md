# redis-isolation

Redis-backed Omni Queue example with a dedicated API producer and a separate worker consumer.

Isolation modes by queue:

- `inline-emails` → `inline`
- `thread-thumbnails` → `thread`
- `process-transcode` → `process` (long-running transcoding simulation)

## Architecture

- API server enqueues jobs into Redis.
- Worker process consumes from Redis and executes jobs with inline/thread/process isolation.

## Prerequisites

- Redis running locally on `127.0.0.1:6379` (or set `REDIS_URL`)
- Build workspace once from repo root:

```bash
npm install
npm run build
```

## Run

Start worker (Terminal 1):

```bash
cd examples/redis-isolation
npm run worker
```

Start API server (Terminal 2):

```bash
cd examples/redis-isolation
npm run server
```

Stop either process with `Ctrl+C`. The example now performs graceful shutdown (closes dashboard WebSocket/server handles, stops schedulers/workers, and closes Redis) before exit.

## API

Health:

```bash
curl http://localhost:3100/health
```

Enqueue inline email job:

```bash
curl -X POST http://localhost:3100/jobs/email \
	-H 'content-type: application/json' \
	-d '{"to":"creator@example.com","subject":"Welcome","body":"Pipeline started"}'
```

Schedule a delayed email job (promoted after 5 seconds):

```bash
curl -X POST http://localhost:3100/jobs/email/schedule \
	-H 'content-type: application/json' \
	-d '{"to":"creator@example.com","subject":"Delayed Welcome","body":"This sends after 5 seconds","delayMs":5000}'
```

Schedule a recurring cron email job:

```bash
curl -X POST http://localhost:3100/jobs/email/schedule \
	-H 'content-type: application/json' \
	-d '{"to":"creator@example.com","subject":"Cron Welcome","body":"This sends every minute","pattern":"0 * * * * *","timezone":"UTC"}'
```

Enqueue thread thumbnail job:

```bash
curl -X POST http://localhost:3100/jobs/thumbnail \
	-H 'content-type: application/json' \
	-d '{"videoId":"vid-thread-100","sourcePath":"/mnt/source.mp4","outputPath":"/mnt/thumbs"}'
```

Enqueue process transcode job:

```bash
curl -X POST http://localhost:3100/jobs/transcode \
	-H 'content-type: application/json' \
	-d '{"videoId":"vid-proc-200","sourcePath":"/mnt/source.mp4","targetPath":"/mnt/hls","profile":"1080p","segmentCount":6}'
```

Inspect dead-letter jobs:

```bash
curl "http://localhost:3100/dlq?queue=process-transcode&limit=50&offset=0"
```

Retry a dead-letter job:

```bash
curl -X POST http://localhost:3100/dlq/retry \
	-H 'content-type: application/json' \
	-d '{"queueName":"process-transcode","jobId":"<job-id>"}'
```

## Environment

- `PORT` (default: `3100`)
- `REDIS_URL` (default: `redis://127.0.0.1:6379`)
- `REDIS_PREFIX` (default: `omniq:redis-isolation`)
- `REDIS_USERNAME` (optional, ACL username)
- `REDIS_PASSWORD` (optional, required if your Redis instance enforces auth)
- `DASHBOARD_ENABLED` (`true`/`false`, default: `false`)
- `DASHBOARD_HOST` (default: `127.0.0.1`)
- `DASHBOARD_PORT` (default: `3210`)
- `DASHBOARD_ROUTE_PREFIX` (default: `/dashboard`)
- `DASHBOARD_AUTH_TYPE` (`none` | `basic` | `bearer`, default: `none`)
- `DASHBOARD_AUTH_LOGIN_MODE` (`token` | `custom`, only for `bearer`, default: `token`)
- `DASHBOARD_BASIC_USERNAME` / `DASHBOARD_BASIC_PASSWORD` (required for `basic`, and also used by `bearer` + `custom` mode)
- `DASHBOARD_BEARER_TOKEN` (required for `bearer` + `token` mode)

Example:

```bash
PORT=4000 REDIS_URL=redis://127.0.0.1:6379 REDIS_PREFIX=omniq:demo npm run server

# If your Redis requires authentication:
REDIS_PASSWORD=your-secret npm run worker

# Enable Supervisor-owned dashboard with basic auth:
DASHBOARD_ENABLED=true \
DASHBOARD_AUTH_TYPE=basic \
DASHBOARD_BASIC_USERNAME=admin \
DASHBOARD_BASIC_PASSWORD=secret \
npm run worker

# Enable bearer token login mode:
DASHBOARD_ENABLED=true \
DASHBOARD_AUTH_TYPE=bearer \
DASHBOARD_AUTH_LOGIN_MODE=token \
DASHBOARD_BEARER_TOKEN=replace-me \
npm run worker

# Enable bearer custom login mode (username/password -> backend-issued session token):
DASHBOARD_ENABLED=true \
DASHBOARD_AUTH_TYPE=bearer \
DASHBOARD_AUTH_LOGIN_MODE=custom \
DASHBOARD_BASIC_USERNAME=admin \
DASHBOARD_BASIC_PASSWORD=secret \
npm run worker
```

When enabled, the worker starts the standalone dashboard server with the built-in login UI. The static dashboard shell is served publicly, while the API and WebSocket routes are protected by the configured auth handler + session validator.

## What this demonstrates

- Shared Redis storage via `@omni-queue/redis-store`
- API producer pattern for pushing jobs over HTTP
- Delayed and scheduled email dispatch over HTTP
- Dead-letter inspection and retry over HTTP
- Worker consumer pattern with Supervisor
- Multiple queues with different isolation strategies
- Long-running transcoding simulation in process isolation
