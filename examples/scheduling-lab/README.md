# scheduling-lab

In-memory scheduling example for delayed, runAt, interval, and cron patterns.

## What this example demonstrates

- `dispatch(..., { delayMs })`
- `schedule(..., { runAt })`
- `schedule(..., { intervalMs })`
- `schedule(..., { pattern, timezone, durable })`
- Deferred-job query + manual promotion (`queryDeferredJobs`, `promoteJob`)
- Stopping recurring schedules via `ScheduledJobHandle.stop()`

## Run

From repository root:

```bash
npm install
npm run build
```

Then run:

```bash
cd examples/scheduling-lab
npm run dev
```
