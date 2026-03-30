# @omni-queue/dashboard-api

HTTP bindings for Omni Queue dashboard APIs.

## Purpose

`@omni-queue/core` only stores dashboard configuration on `Supervisor`. This package turns that configuration into:

- a reusable dashboard route mounting helper

Default framework adapter package: `@omni-queue/express-adapter`.

## Example

```ts
import express from 'express';
import { Supervisor } from '@omni-queue/core';
import { omniQueueExpressAdapter } from '@omni-queue/express-adapter';

const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters,
  dashboard: {
    enabled: true,
    endpoint: '/queue-manager',
    auth: {
      type: 'basic',
      validator: ({ username, password }) => username === 'test' && password === 'password',
    },
  },
});

const app = express();
app.use(
  omniQueueExpressAdapter({
    supervisor,
    apiBase: '/queue-manager',
  })
);
```
