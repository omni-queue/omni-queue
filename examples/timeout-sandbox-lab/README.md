# timeout-sandbox-lab

In-memory timeout and sandbox policy behavior example.

## What this example demonstrates

- Queue execution timeout (`executionTimeoutMs`) with timeout fail strategy (`timeoutStrategy: 'fail'`)
- Immediate dead-letter behavior for timeout-driven failures (`maxAttempts: 1`)
- Sandbox policy + inline isolation mismatch behavior (sandbox requires non-inline isolation)

## Run

From repository root:

```bash
npm install
npm run build
```

Then run:

```bash
cd examples/timeout-sandbox-lab
npm run dev
```

## Expected output

- Timed queue DLQ entry with timeout-related error
- Sandboxed-inline queue DLQ entry describing required non-inline isolation
