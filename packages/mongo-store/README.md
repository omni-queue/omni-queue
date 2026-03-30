# `@omni-queue/mongo-store`

MongoDB storage adapter for [Omni-Queue](../../README.md).

Uses the official MongoDB Node.js driver with atomic `findOneAndUpdate` leasing semantics for safe concurrent dequeue.

## Installation

```bash
npm install @omni-queue/mongo-store mongodb
```

## Usage

```ts
import { MongoStore } from '@omni-queue/mongo-store';

const store = new MongoStore({
	client: {},
	uri: 'mongodb://127.0.0.1:27017',
	dbName: 'omni_queue',
});

await store.migrate();
```

## Features

- Queue lifecycle support (`enqueue`, `dequeue`, `ack`, `fail`, `extendLease`)
- Deferred jobs and promotion support
- Dead-letter queue and retry support
- Progress tracking
- Completed jobs archive with retention controls
