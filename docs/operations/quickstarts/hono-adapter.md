# Hono adapter quickstart

Use this pattern for lightweight edge-style APIs that enqueue background work.

## Generate a starter

```bash
vasto generate api-job --name=publish-webhook -=edge-api
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

## Dashboard mounting

```ts
import path from 'node:path';
import { vastoHonoAdapter, bindVastoHonoWebSocket } from '@vasto/hono-adapter';

const handler = vastoHonoAdapter({
  supervisor,
  apiBase: '/api/vasto',
  uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
  protectUiWithAuth: false,
});

// If you own the underlying Node server:
bindVastoHonoWebSocket(server, {
  supervisor,
  apiBase: '/api/vasto',
});
```

Publish the UI assets once:

```bash
queue dashboard:publish --out=./public/vasto-dashboard
```

If WebSocket upgrades are blocked by a proxy or edge environment, force polling at runtime by injecting this before the dashboard `<script>` tag in your page template:

```html
<script>
  window.__VASTO_DASHBOARD_CONFIG__ = {
    transport: 'polling',          // 'auto' (default) | 'polling'
    endpoint:  '/api/vasto',  // must match apiBase above
  };
</script>
```

Or append `?transport=polling` to the dashboard URL for a quick per-request test.
