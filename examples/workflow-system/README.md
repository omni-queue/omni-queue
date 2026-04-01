# workflow-system

In-memory workflow example focused on DAG orchestration and batch follow-up jobs.

## What this example demonstrates

- Flow orchestration with `supervisor.dispatchFlow(...)`
- Dependency ordering with `dependsOn`
- Batch dispatch with `supervisor.jobManager.dispatchBatch(...)`
- One-time scheduling with `runAt`
- Lifecycle event subscription for flow/job visibility

## Run

From repository root:

```bash
npm install
npm run build
```

Then run the example:

```bash
cd examples/workflow-system
npm run dev
```

## Expected output

- Initial flow state printed after dispatch
- Event logs for node/job completion
- Batch details and final flow state after a short wait

## Project structure

```text
src/
  index.ts
```
