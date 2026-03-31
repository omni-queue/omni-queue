# Fastify adapter quickstart

Use Fastify handlers to validate input and dispatch typed jobs.

## Generate a starter

```bash
queue generate api-job --name=sync-customer --queue=fastify-api
```

## Example route

```ts
fastify.post('/customers/sync', async (request, reply) => {
  const job = new SyncCustomerApiJob({
    requestId: crypto.randomUUID(),
    body: request.body as Record<string, unknown>,
  });

  const dispatched = await jobManager.dispatch(job);
  return reply.code(202).send({ accepted: true, jobId: dispatched.id });
});
```

## Notes

- Keep schema validation in Fastify.
- Use queue-level backpressure when routes can spike.
- Stream lifecycle events into operational dashboards for support teams.
