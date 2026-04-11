---
title: Storage Backends
description: Compare Vasto's storage adapters and learn how to connect each one.
outline: deep
---

# Storage Backends

Every queue config has a `connection` key that maps to a storage adapter in `storageAdapters`. Swapping backends requires changing only that map — your job classes stay the same.

## Comparison

| Adapter | Package | Persistence | Distributed | Best for |
|---|---|---|---|---|
| `InMemoryQueueStorage` | `@vasto-queue/core` | None | No | Unit tests, local dev |
| `FileQueueStorage` | `@vasto-queue/core` | JSON files | Multi-process | Local dev without infra |
| `RedisQueueStorage` | `@vasto-queue/redis-store` | Optional | Yes | Production default, low latency |
| `PostgresQueueStorage` | `@vasto-queue/postgres-store` | Full | Yes | SQL-centric stacks |
| `MySQLQueueStorage` | `@vasto-queue/mysql-store` | Full | Yes | MySQL ecosystem |
| `MongoQueueStorage` | `@vasto-queue/mongo-store` | Full | Yes | Document/cloud workloads |
| `DynamoDBQueueStorage` | `@vasto-queue/dynamodb-store` | Full | Yes | AWS-native deployments |

---

## In-Memory

Built into `@vasto-queue/core`. No installation required. State is lost when the process exits.

```ts
import { InMemoryQueueStorage } from '@vasto-queue/core';

const supervisor = new Supervisor({
  // ...
  storageAdapters: {
    memory: new InMemoryQueueStorage(),
  },
});
```

::: warning Not for production
In-memory storage has no persistence and no cross-process sharing. Use it for tests and quick local iteration only.
:::

---

## File

Also built into `@vasto-queue/core`. Persists jobs as JSON files on disk. Uses `fs.renameSync` for atomic cross-process claim semantics, so multiple processes can share the same data directory safely.

```ts
import { FileQueueStorage } from '@vasto-queue/core';

const supervisor = new Supervisor({
  // ...
  storageAdapters: {
    file: new FileQueueStorage('./queue-data'),  // directory is created if absent
  },
});
```

::: tip No migrations needed
`FileQueueStorage` manages its own directory structure. There is no schema to migrate.
:::

---

## Redis

::: code-group

```sh [npm]
npm install @vasto-queue/redis-store
```

```sh [pnpm]
pnpm add @vasto-queue/redis-store
```

:::

```ts
import { RedisQueueStorage } from '@vasto-queue/redis-store';

const supervisor = new Supervisor({
  // ...
  storageAdapters: {
    redis: new RedisQueueStorage({
      host: process.env.REDIS_HOST,
      port: 6379,
    }),
  },
});
```

Redis is the recommended default for distributed production workloads. It has the lowest overhead and best throughput of all the adapters.

---

## Postgres

::: code-group

```sh [npm]
npm install @vasto-queue/postgres-store
```

```sh [pnpm]
pnpm add @vasto-queue/postgres-store
```

:::

```ts
import { PostgresQueueStorage } from '@vasto-queue/postgres-store';

const storage = new PostgresQueueStorage({
  connectionString: process.env.DATABASE_URL,
});
await storage.migrate(); // run once at startup to create schema

const supervisor = new Supervisor({
  // ...
  storageAdapters: { postgres: storage },
});
```

::: warning Run migrate() before start
Postgres and MySQL adapters require a schema migration step before the first `supervisor.start()`.
:::

---

## MySQL

::: code-group

```sh [npm]
npm install @vasto-queue/mysql-store
```

```sh [pnpm]
pnpm add @vasto-queue/mysql-store
```

:::

```ts
import { MySQLQueueStorage } from '@vasto-queue/mysql-store';

const storage = new MySQLQueueStorage({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
});
await storage.migrate();
```

---

## MongoDB

::: code-group

```sh [npm]
npm install @vasto-queue/mongo-store
```

```sh [pnpm]
pnpm add @vasto-queue/mongo-store
```

:::

```ts
import { MongoQueueStorage } from '@vasto-queue/mongo-store';

const supervisor = new Supervisor({
  // ...
  storageAdapters: {
    mongo: new MongoQueueStorage({
      uri: process.env.MONGO_URI,
      dbName: 'myapp-jobs',
    }),
  },
});
```

---

## DynamoDB

::: code-group

```sh [npm]
npm install @vasto-queue/dynamodb-store
```

```sh [pnpm]
pnpm add @vasto-queue/dynamodb-store
```

:::

```ts
import { DynamoDBQueueStorage } from '@vasto-queue/dynamodb-store';

const supervisor = new Supervisor({
  // ...
  storageAdapters: {
    dynamo: new DynamoDBQueueStorage({
      region: process.env.AWS_REGION,
      tableName: 'vasto-jobs',
    }),
  },
});
```

---

## Using multiple adapters at once

Different queues can use different adapters in the same supervisor instance:

```ts
const supervisor = new Supervisor({
  queues: defineQueues({
    emails: { name: 'emails', connection: 'redis', concurrency: 10, batchSize: 20 },
    reports: { name: 'reports', connection: 'postgres', concurrency: 2, batchSize: 5 },
    local:   { name: 'local',   connection: 'memory',   concurrency: 1, batchSize: 1 },
  }),
  // ...
  storageAdapters: {
    redis:    new RedisQueueStorage({ host: 'localhost', port: 6379 }),
    postgres: postgresStorage,
    memory:   new InMemoryQueueStorage(),
  },
});
```

- Package: `@vasto-queue/mongo-store`
- Document-model fit for JSON-first environments

## DynamoDB

- Package: `@vasto-queue/dynamodb-store`
- Cloud-native key-value storage on AWS

## Decision Tips

- Need raw queue latency at scale: Redis
- Need SQL and strong data governance: Postgres or MySQL
- Need local development with no external infra: In-memory or File
