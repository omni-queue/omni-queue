# `@vasto-queue/redis-store`

Redis storage adapter for [Vasto](../../README.md).

Uses [ioredis](https://github.com/redis/ioredis) with a Lua-scripted atomic dequeue that handles visibility timeouts and expired-lease reclaim without external locks.

## Installation

```bash
npm install @vasto-queue/redis-store ioredis
```

## Usage

```ts
import { RedisStore } from '@vasto-queue/redis-store';

const store = new RedisStore({
	client: {
		host: 'localhost',
		port: 6379,
	},
});
```

Or pass a pre-configured ioredis instance:

```ts
import Redis from 'ioredis';
import { RedisStore } from '@vasto-queue/redis-store';

const redis = new Redis({ host: 'localhost', port: 6379 });
const store = new RedisStore({ client: redis });
```

Pass the store as a connection adapter to your queue config:

```ts
import { defineQueues, defineWorkers } from '@vasto-queue/core';

const queues = defineQueues({
	default: {
		name: 'default',
		connection: 'redis',
		concurrency: 5,
		batchSize: 10,
		retry: { attempts: 3, maxAttempts: 3, backoff: 'exponential' },
	},
});

const storageAdapters = { redis: store };
```

## Key Layout

| Key | Type | Purpose |
|---|---|---|
| `vasto:job:{id}` | string (JSON) | Full job payload |
| `vasto:queue:{name}:ready` | sorted set (score = createdAt) | Jobs waiting to run |
| `vasto:queue:{name}:leased` | sorted set (score = leaseUntil) | Inflight jobs |
| `vasto:dead:{id}` | string (JSON) | Dead-lettered job copy |
| `vasto:queue:{name}:dead` | sorted set (score = failedAt) | Dead-letter index |

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `client` | `Redis \| RedisOptions` | — | ioredis instance or config |
| `prefix` | `string` | `vasto` | Key namespace prefix |