# poison-policy-lab

In-memory poison-message policy example.

## What this example demonstrates

- Quarantine template tagging into DLQ
- Auto-snooze template re-enqueueing into deferred state
- Escalation template DLQ tagging with escalation marker

## Run

From repository root:

```bash
npm install
npm run build
```

Then run:

```bash
cd examples/poison-policy-lab
npm run dev
```
