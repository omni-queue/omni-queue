# `@omni-queue/redis-store`

Redis storage adapter for [Omni-Queue](../../README.md).

Uses [ioredis](https://github.com/redis/ioredis) with a Lua-scripted atomic dequeue that handles visibility timeouts and expired-lease reclaim without external locks.

## Installation

```bash
npm install @omni-queue/redis-store ioredis
```

## Usage

```ts
import { RedisStore } from '@omni-queue/redis-store';

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
import { RedisStore } from '@omni-queue/redis-store';

const redis = new Redis({ host: 'localhost', port: 6379 });
const store = new RedisStore({ client: redis });
```

Pass the store as a connection adapter to your queue config:

```ts
import { defineQueues, defineWorkers } from '@omni-queue/core';

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
| `omni:job:{id}` | string (JSON) | Full job payload |
| `omni:queue:{name}:ready` | sorted set (score = createdAt) | Jobs waiting to run |
| `omni:queue:{name}:leased` | sorted set (score = leaseUntil) | Inflight jobs |
| `omni:dead:{id}` | string (JSON) | Dead-lettered job copy |
| `omni:queue:{name}:dead` | sorted set (score = failedAt) | Dead-letter index |

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `client` | `Redis \| RedisOptions` | — | ioredis instance or config |
| `prefix` | `string` | `omni` | Key namespace prefix |