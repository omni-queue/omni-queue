---
title: Getting Started
description: Install Vasto Queue and run your first job in minutes.
outline: deep
---

# Getting Started

## Prerequisites

- Node.js **20** or higher
- TypeScript (recommended — Vasto Queue is fully typed)

## Installation

::: code-group

```sh [npm]
npm install @vasto-queue/core
```

```sh [pnpm]
pnpm add @vasto-queue/core
```

```sh [yarn]
yarn add @vasto-queue/core
```

:::

## Define your first job

Every job is a class that extends `Job`, declares a unique `static jobName`, and implements `handle()`.

```ts
import { Job } from '@vasto-queue/core';

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

export class SendEmailJob extends Job<EmailPayload> {
  static jobName = 'SendEmailJob';

  queue() {
    return 'emails';
  }

  async handle(payload: EmailPayload) {
    // your email-sending logic here
    console.log(`Sending email to ${payload.to}`);
  }
}
```

::: tip Class-based registry
The `static jobName` is how Vasto Queue resolves the correct class at execution time. It must be globally unique.
:::

## Create the runtime

```ts
import {
  defineQueues,
  defineWorkers,
  InMemoryQueueStorage,
  JobRegistry,
  Supervisor,
} from '@vasto-queue/core';
import { SendEmailJob } from './jobs/send-email-job';

// 1. Declare queue and worker configs
const queues = defineQueues({
  emails: {
    name: 'emails',
    connection: 'memory',
    concurrency: 5,
    batchSize: 10,
  },
});

const workers = defineWorkers({
  main: {
    queues: ['emails'],
    concurrency: 2,
    isolation: 'inline',
  },
});

// 2. Register job classes
const registry = new JobRegistry();
registry.register(SendEmailJob);

// 3. Assemble the supervisor
const supervisor = new Supervisor({
  queues,
  workers,
  registry,
  storageAdapters: { memory: new InMemoryQueueStorage() },
});
```

## Dispatch and start

```ts
// Dispatch before or after start — jobs queue up in storage either way
await supervisor.jobManager.dispatch(
  new SendEmailJob({
    to: 'alice@example.com',
    subject: 'Welcome',
    body: 'Hello!',
  })
);

await supervisor.start();
```

::: info Dispatch options
`dispatch()` accepts an optional second argument for delays, priorities, and idempotency keys. See [Core Runtime API](/api/core-runtime#dispatch-options) for the full interface.
:::

## Next steps

<div class="tip custom-block" style="padding-top: 8px">

Now that you have the basics, explore what Vasto Queue can do:

- [Core Concepts](/guide/core-concepts) — understand Supervisor, JobManager, and the registry
- [Workers and Isolation](/guide/workers-and-isolation) — choose between inline, thread, and process workers
- [Storage Backends](/guide/storage-backends) — connect Redis, Postgres, or keep in-memory
- [Plugins and Lifecycle](/guide/plugins-and-lifecycle) — add observability hooks

</div>
