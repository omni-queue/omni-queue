# Elysia adapter quickstart

Use this pattern when you want to host Vasto inside an Elysia app on Bun.

## Generate a starter

```bash
vasto generate api-job --name=send-email -=elysia-api
```

## Example integration

```ts
import path from 'node:path';
import { Elysia } from 'elysia';
import { registerElysiaAdapter } from '@vasto-queue/elysia-adapter';

const app = new Elysia();

const dashboard = registerElysiaAdapter(app, {
  supervisor,
  apiBase: '/api/vasto',
  uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
  uiBase: '/',
  protectUiWithAuth: false,
});

await dashboard.waitUntilReady();

app.listen(3000);
```

## Notes

- publish the UI assets with `vasto dashboard:publish --out=./public/vasto-dashboard`
- `dashboard:publish` resolves assets from installed `@vasto-queue/dashboard` in `node_modules`
- live updates use native WebSocket transport at `<apiBase>/ws` (for example `/api/vasto/ws`)
- for built assets, force polling with runtime config (no rebuild):

  ```html
  <script>
    window.__VASTO_DASHBOARD_CONFIG__ = { transport: 'polling' };
  </script>
  ```

- for local dev only, `VITE_DASHBOARD_TRANSPORT=polling npm run dev` also works
