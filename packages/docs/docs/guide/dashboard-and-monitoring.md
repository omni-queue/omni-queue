---
title: Dashboard and Monitoring
description: Mount the Vasto dashboard into your existing web framework in minutes.
outline: deep
---

# Dashboard and Monitoring

Vasto ships a first-party web dashboard that you mount into any existing HTTP app. No separate server required.

## How it works

1. **`@vasto-queue/dashboard`** — the frontend SPA (built and published separately)
2. **`@vasto-queue/dashboard-api`** — HTTP handlers, WebSocket relay, and auth middleware
3. **Framework adapters** — thin wrappers that bind 1 and 2 to your specific framework

The dashboard reads live state from the supervisor and updates in real time via WebSocket.

## Publishing the dashboard assets

Before mounting, publish the frontend assets into your project:

```sh
npx vst dashboard:publish --base=/dashboard --api-base=/api/vasto
```

This copies the built SPA into a `public/vasto-dashboard` directory (or the path you configure).

## Framework adapters

::: code-group

```ts [Hono]
import { vastoHonoAdapter, bindVastoHonoWebSocket } from '@vasto-queue/hono-adapter';
import path from 'node:path';

const handler = vastoHonoAdapter({
  supervisor,
  apiBase: '/api/vasto',
  uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
});

// Bind WebSocket if you have access to the underlying Node server
bindVastoHonoWebSocket(server, { supervisor, apiBase: '/api/vasto' });
```

```ts [Express]
import { vastoExpressAdapter } from '@vasto-queue/express-adapter';
import path from 'node:path';

app.use(
  vastoExpressAdapter({
    supervisor,
    apiBase: '/api/vasto',
    uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
  })
);
```

```ts [Fastify]
import { vastoFastifyAdapter } from '@vasto-queue/fastify-adapter';
import path from 'node:path';

await app.register(vastoFastifyAdapter, {
  supervisor,
  apiBase: '/api/vasto',
  uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
});
```

```ts [NestJS]
import { VastoNestModule } from '@vasto-queue/nestjs-adapter';

@Module({
  imports: [
    VastoNestModule.forRoot({
      supervisor,
      apiBase: '/api/vasto',
      uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
    }),
  ],
})
export class AppModule {}
```

```ts [Elysia]
import { vastoElysiaAdapter } from '@vasto-queue/elysia-adapter';
import path from 'node:path';

app.use(
  vastoElysiaAdapter({
    supervisor,
    apiBase: '/api/vasto',
    uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
  })
);
```

:::

## Adding authentication

Pass a `protectUiWithAuth` callback to restrict dashboard access:

```ts
vastoHonoAdapter({
  supervisor,
  apiBase: '/api/vasto',
  uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
  protectUiWithAuth: async (req) => {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    return verifyAdminToken(token);  // return true to allow, false to reject
  },
});
```

## What you can see in the dashboard

| Panel | Description |
|---|---|
| Queue overview | Ready, active, deferred, and failed job counts per queue |
| Failed jobs | Inspect error details, retry individual or all failed jobs |
| Dead-letter queue | View permanently failed jobs |
| Scheduled jobs | Active cron and interval schedules |
| Workers | Running worker count, concurrency, and isolation mode |
| Circuit breaker | Backpressure and circuit state per queue |

## Production rollout checklist

::: details Expand checklist
- [ ] Dashboard is mounted behind authentication
- [ ] `apiBase` path does not conflict with application routes
- [ ] Failed job retry actions are limited to authorized users
- [ ] Dashboard WebSocket endpoint is behind the same auth layer
- [ ] Metrics exporter (if any) is separate from the dashboard WebSocket
:::

## Related

- [Operations overview](/operations/) — capacity planning and production readiness
- [CLI reference](/api/cli-reference) — `dashboard:publish` command details
