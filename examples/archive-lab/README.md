# archive-lab

In-memory completed-job archive query example.

## What this example demonstrates

- Completed job history via `getCompletedJobs`
- Archive-style filtering via `queryJobArchive`
- Retention policy API wiring via `setArchiveRetentionPolicy`
- Cleanup of completed records via `cleanJobs(..., { status: 'completed' })`

## Run

From repository root:

```bash
npm install
npm run build
```

Then run:

```bash
cd examples/archive-lab
npm run dev
```
