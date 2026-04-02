# idempotency-lab

In-memory idempotency and deduplication behavior example.

## What this example demonstrates

- Dispatching with `idempotencyKey`
- Duplicate dispatch collapsing to the same job id during in-flight and recently completed windows
- New dispatch after `dedupeWindowMs` expires

## Run

From repository root:

```bash
npm install
npm run build
```

Then run:

```bash
cd examples/idempotency-lab
npm run dev
```

## Expected output

- `id1 === id2` and `id1 === id3` while inside dedupe window
- `id4 !== id1` once dedupe window expires
- Completed jobs list showing deduplicated history
