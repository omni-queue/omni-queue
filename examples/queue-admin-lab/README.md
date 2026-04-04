# queue-admin-lab

In-memory queue administration example.

## What this example demonstrates

- Queue status summary (`getQueueStatus`)
- Deferred inspection + promotion (`queryDeferredJobs`, `promoteJob`)
- Ready-job removal (`removeJob`)
- Cleanup by status (`cleanJobs`)
- Full queue wipe (`obliterateQueue`)
- Ready/active/completed visibility (`getReadyJobs`, `getCompletedJobs`)

## Run

From repository root:

```bash
npm install
npm run build
```

Then run:

```bash
cd examples/queue-admin-lab
npm run dev
```
