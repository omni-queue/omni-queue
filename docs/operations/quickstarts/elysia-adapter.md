# Elysia adapter quickstart

Use this pattern when you want to host Omni Queue inside an Elysia app on Bun.

## Generate a starter

```bash
queue generate api-job --name=send-email --queue=elysia-api
```

## Example integration

```ts
import path from 'node:path';
import { Elysia } from 'elysia';
import { registerElysiaAdapter } from '@omni-queue/elysia-adapter';

const app = new Elysia();

const dashboard = registerElysiaAdapter(app, {
  supervisor,
  apiBase: '/api/omni-queue',
  uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
  uiBase: '/',
  protectUiWithAuth: false,
});

await dashboard.waitUntilReady();

app.listen(3000);
```

## Notes

- publish the UI assets with `queue dashboard:publish --out=./public/omni-queue-dashboard`
- `dashboard:publish` resolves assets from installed `@omni-queue/dashboard` in `node_modules`
- live updates use native WebSocket transport at `<apiBase>/ws` (for example `/api/omni-queue/ws`)
- for built assets, force polling with runtime config (no rebuild):

  ```html
  <script>
    window.__OMNI_QUEUE_DASHBOARD_CONFIG__ = { transport: 'polling' };
  </script>
  ```

- for local dev only, `VITE_DASHBOARD_TRANSPORT=polling npm run dev` also works
