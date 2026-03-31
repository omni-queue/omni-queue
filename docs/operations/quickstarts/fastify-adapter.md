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

## Dashboard mounting

```ts
import path from 'node:path';
import {
  bindOmniQueueFastifyWebSocket,
  omniQueueFastifyAdapter,
} from '@omni-queue/fastify-adapter';

await fastify.register(import('@fastify/middie'));
fastify.use(
  omniQueueFastifyAdapter({
    supervisor,
    apiBase: '/api/omni-queue',
    uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
    uiBase: '/',
    protectUiWithAuth: true,
  })
);

bindOmniQueueFastifyWebSocket(fastify.server, {
  supervisor,
  apiBase: '/api/omni-queue',
});
```

Publish the UI assets once:

```bash
queue dashboard:publish --out=./public/omni-queue-dashboard
```

If WebSocket upgrades are blocked by a proxy or serverless environment, force polling at runtime by injecting this before the dashboard `<script>` tag in your page template:

```html
<script>
  window.__OMNI_QUEUE_DASHBOARD_CONFIG__ = {
    transport: 'polling',          // 'auto' (default) | 'polling'
    endpoint:  '/api/omni-queue',  // must match apiBase above
  };
</script>
```

Or append `?transport=polling` to the dashboard URL for a quick per-request test.
