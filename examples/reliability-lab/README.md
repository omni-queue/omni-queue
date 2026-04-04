# reliability-lab

In-memory reliability and queue-operations example.

## What this example demonstrates

- Job-level retries + backoff + custom `retryPolicy`
- Dead-letter queue inspection and retry (`getDLQ`, `retryDLQ`)
- Queue controls (`pauseQueue`, `drainQueue`, `resumeQueue`)
- Queue reliability configuration (`rateLimit`, `backpressure`, `circuitBreaker`)
- Lifecycle event stream and reliability snapshot

## Run

From repository root:

```bash
npm install
npm run build
```

Then run the example:

```bash
cd examples/reliability-lab
npm run dev
```

## Expected output

- Job failure/retry/dead-letter lifecycle events
- DLQ listing and one retry attempt
- Reliability snapshot with breaker/backpressure summary

## Project structure

```text
src/
  index.ts
```
