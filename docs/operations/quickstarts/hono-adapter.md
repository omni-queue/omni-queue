# Hono adapter quickstart

Use this pattern for lightweight edge-style APIs that enqueue background work.

## Generate a starter

```bash
queue generate:api-job --name=publish-webhook --queue=edge-api
```

## Example route

```ts
app.post('/webhooks/publish', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const job = new PublishWebhookApiJob({
    requestId: crypto.randomUUID(),
    body,
  });

  const dispatched = await jobManager.dispatch(job);
  return c.json({ accepted: true, jobId: dispatched.id }, 202);
});
```

## Notes

- Keep edge handlers small.
- Use scheduled templates for recurring edge maintenance tasks.
- Prefer workflow templates when fan-out or dependency ordering is required.
