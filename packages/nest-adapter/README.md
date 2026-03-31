# `@omni-queue/nest-adapter`

NestJS integration adapter for Omni-Queue dashboard API.

Use the adapter middleware with an Express-based Nest app.

## Usage

```ts
import path from 'node:path';
import {
  bindOmniQueueNestWebSocket,
  omniQueueNestAdapter,
} from '@omni-queue/nest-adapter';

app.use(
  omniQueueNestAdapter({
    supervisor,
    apiBase: '/api/omni-queue',
    uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
    uiBase: '/',
    protectUiWithAuth: true,
  })
);

bindOmniQueueNestWebSocket(app.getHttpServer(), {
  supervisor,
  apiBase: '/api/omni-queue',
});
```

Publish the UI assets into that folder with `queue dashboard:publish --out=./public/omni-queue-dashboard`.
