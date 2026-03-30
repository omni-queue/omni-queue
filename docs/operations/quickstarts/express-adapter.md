# Express adapter quickstart

Use this pattern when an HTTP route should enqueue work and immediately return a tracking identifier.

## Shape

1. Create a typed API job.
2. Dispatch it from an Express handler.
3. Return the job id or correlation id.

## Suggested files

- `src/jobs/send-email.api-job.ts`
- `src/server.ts`

## Generate a starter

```bash
queue generate:api-job --name=send-email --queue=api-jobs
```

## Example route

```ts
app.post('/emails', async (req, res) => {
  const job = new SendEmailApiJob({
    requestId: crypto.randomUUID(),
    body: req.body,
  });

  const dispatched = await jobManager.dispatch(job);
  res.status(202).json({ accepted: true, jobId: dispatched.id });
});
```

## Notes

- Keep request validation in the route.
- Keep side effects inside the job handler.
- Use idempotency or dedupe keys for externally triggered calls.
