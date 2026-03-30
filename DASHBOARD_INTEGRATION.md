# Dashboard Integration Guide

The dashboard is now fully integrated with the omni-queue examples. Each example can run with a live dashboard for monitoring and managing jobs.

## Quick Start

### Option 1: redis-isolation Example (Recommended for Production)

The redis-isolation example demonstrates a real-world setup with Redis backend and both producer and consumer workers.

```bash
# Terminal 1: Build and start the API server
cd examples/redis-isolation
npm install  # if needed
npm run server:dev

# Terminal 2: Start the dashboard UI (in another terminal, from workspace root)
cd packages/dashboard
npm run dev
```

Then open http://localhost:5173 in your browser.

**API Server**: http://localhost:3100  
**Dashboard UI**: http://localhost:5173  
**Dashboard API**: http://localhost:3100/api/dashboard

#### Endpoints Available

- `GET /health` - Health check
- `POST /jobs/email` - Queue an email job
- `POST /jobs/email/schedule` - Schedule email with delay/cron
- `POST /jobs/thumbnail` - Generate video thumbnail
- `POST /jobs/transcode` - Transcode video
- `POST /jobs/progress` - Update job progress
- `POST /dlq/retry` - Retry a dead-letter job
- `GET /api/dashboard/*` - Dashboard data endpoints

#### One-Command Start

Alternatively, run both together with:

```bash
cd examples/redis-isolation
npm run dev:dashboard
```

This uses `concurrently` to start both the server and dashboard in one terminal.

---

### Option 2: queue-system Example (In-Memory, Simple)

The queue-system example is simpler, using in-memory storage and thread workers.

```bash
# Terminal 1: Build and start the API server
cd examples/queue-system
npm install  # if needed
npm run server:dev

# Terminal 2: Start the dashboard UI (in another terminal, from workspace root)
cd packages/dashboard
npm run dev
```

Then open http://localhost:5173 in your browser.

**API Server**: http://localhost:3110 (different port)  
**Dashboard UI**: http://localhost:5173  
**Dashboard API**: http://localhost:3110/api/dashboard

#### One-Command Start

```bash
cd examples/queue-system
npm run dev:dashboard
```

---

## Dashboard Features

Once the dashboard is running, you can:

1. **Overview** - See total jobs, deferred, and dead-letter counts
2. **Queues** - View all queues and their stats, drill down to queue details
3. **Jobs** - Browse jobs by queue and status (deferred/promoted/DLQ), view job details
4. **Workers** - Monitor worker configuration and adjust scaling concurrency live
5. **Dead Letter** - View and retry failed jobs
6. **Metrics** - See trends over time with sparklines and historical data

### Navigation

- Click queue names to see queue-specific job details
- Click job IDs or names to view full job metadata and payload
- Click worker names to see worker configuration and assigned queues
- From queue/job/worker detail pages, click linked items to explore relationships

---

## Architecture

### Dashboard Packages

- **@omni-queue/dashboard-api** - Express middleware providing `/api/dashboard/*` endpoints
  - `createDashboardRequestHandler()` - Main factory function
  - Integrates with your Supervisor to expose its data via HTTP/WebSocket
  - Built-in WebSocket support for live streaming
  - Automatic HTTP polling fallback when WebSocket unavailable

- **@omni-queue/dashboard** - React + Vite frontend
  - React Router for client-side navigation
  - Real-time data via WebSocket + context provider
  - Type-safe data structures aligned with supervisor API

### How It Works

1. **API Server** - Creates a Supervisor instance and mounts dashboard middleware:
   ```typescript
   const supervisor = new Supervisor({ queues, workers, registry, storageAdapters });
   const handler = createDashboardRequestHandler({ supervisor, endpoint: '/api/dashboard' });
   handler(app);
   ```

2. **Dashboard UI** - Connects to `/api/dashboard` and renders data:
   - Uses `DashboardDataProvider` context for shared state
   - Routes to different pages: overview, queues, jobs, workers, dlq, metrics
   - WebSocket auto-reconnects with HTTP polling fallback

3. **Live Updates** - Changes are reflected instantly:
   - Job dispatch → appears in queue immediately
   - DLQ retry → removed from dead-letter list
   - Scaling adjustment → updates worker concurrency
   - All via WebSocket (2s interval) or polling (5s fallback)

---

## Configuration

### Environment Variables

#### Dashboard API (`examples/*/src/server.ts`)

```bash
PORT=3100          # API server port (default: 3100 for redis-isolation, 3110 for queue-system)
REDIS_URL=...      # Redis connection (redis-isolation only)
REDIS_KEY_PREFIX=...  # Redis key namespace (redis-isolation only)
```

#### Dashboard UI (`packages/dashboard`)

```bash
VITE_DASHBOARD_ENDPOINT=/api/dashboard  # API base URL (default)
```

To use a different API:

```bash
VITE_DASHBOARD_ENDPOINT=http://localhost:3100/api/dashboard npm run dev
```

---

## Troubleshooting

### Dashboard shows "Loading..." forever

1. Check that the API server is running:  
   `curl http://localhost:3100/health`

2. Check WebSocket connection in browser DevTools (F12 → Network → WS tab)

3. If WebSocket fails, it will fall back to HTTP polling after 3s

### Jobs not appearing in dashboard

1. Make sure supervisor is initialized in the server:
   ```typescript
   const supervisor = new Supervisor({ queues, workers, registry, storageAdapters });
   ```

2. And passed to the dashboard handler:
   ```typescript
   const handler = createDashboardRequestHandler({ supervisor });
   ```

3. Check that jobs match defined queue names

### "Cannot find module" errors

1. Run `npm install` in the workspace root
2. Rebuild: `npm run build` in the packages/dashboard-api directory
3. Rebuild examples: `npm run build` in the example directory

---

## Next Steps

- **Customize Dashboard** - Modify dashboard UI components in `packages/dashboard/src`
- **Add Custom Endpoints** - Extend the API server with job-specific endpoints
- **Deploy** - Build and serve dashboard assets from your production API server
- **Auth** - Add authentication layer before mounting dashboard middleware (optional)

---

## File Reference

**Examples:**
- `examples/redis-isolation/src/server.ts` - Express server with dashboard
- `examples/queue-system/src/server.ts` - Express server with dashboard

**Dashboard:**
- `packages/dashboard-api/src/index.ts` - Main exports and factories
- `packages/dashboard/src/contexts/DashboardDataContext.tsx` - Data provider
- `packages/dashboard/src/pages/*.tsx` - Page components
- `packages/dashboard/src/App.tsx` - Route definitions

