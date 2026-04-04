# queue-system

In-memory Vasto example demonstrating multi processing, plugins, and dashboard integration.

## What this example includes

- Multiple queues: `emails`, `reports`, `maintenance`
- Worker isolation via thread runtime modules
- Built-in plugins (`DAGPlugin`, `RateLimiterPlugin`) + OTel tracing plugin
- Dashboard API + WebSocket mounting through `@vasto/express-adapter`

## Install from npm

```bash
cd examples/queue-system
npm install
```

To publish dashboard assets with the CLI:

```bash
npx @vasto/cli dashboard:publish --out=./public/vasto-dashboard --base=/dashboard --api-base=/api/dashboard
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

## Why worker is separate from server

Do not run queue workers inside the HTTP server process.

- API responsiveness stays stable under background load.
- Worker scaling and server scaling can be tuned independently.
- Crash and rollout boundaries stay isolated.

## Health check

```bash
curl http://localhost:3110/health
```

## Notes

- Dashboard WebSocket updates are enabled by default.
- The process supports graceful shutdown on `Ctrl+C` (closes websocket/server handles and stops workers).