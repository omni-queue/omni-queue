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
| `InMemoryQueueStorage` | `@vasto/core` | None | No | Unit tests, local dev |
| `FileQueueStorage` | `@vasto/core` | JSON files | Multi-process | Local dev without infra |
| `RedisQueueStorage` | `@vasto/redis-store` | Optional | Yes | Production default, low latency |
| `PostgresQueueStorage` | `@vasto/postgres-store` | Full | Yes | SQL-centric stacks |
| `MySQLQueueStorage` | `@vasto/mysql-store` | Full | Yes | MySQL ecosystem |
| `MongoQueueStorage` | `@vasto/mongo-store` | Full | Yes | Document/cloud workloads |
| `DynamoDBQueueStorage` | `@vasto/dynamodb-store` | Full | Yes | AWS-native deployments |

---

## In-Memory

Built into `@vasto/core`. No installation required. State is lost when the process exits.

```ts
import { InMemoryQueueStorage } from '@vasto/core';

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

Also built into `@vasto/core`. Persists jobs as JSON files on disk. Uses `fs.renameSync` for atomic cross-process claim semantics, so multiple processes can share the same data directory safely.

```ts
import { FileQueueStorage } from '@vasto/core';

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
npm install @vasto/redis-store
```

```sh [pnpm]
pnpm add @vasto/redis-store
```

:::

```ts
import { RedisQueueStorage } from '@vasto/redis-store';

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
npm install @vasto/postgres-store
```

```sh [pnpm]
pnpm add @vasto/postgres-store
```

:::

```ts
import { PostgresQueueStorage } from '@vasto/postgres-store';

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
npm install @vasto/mysql-store
```

```sh [pnpm]
pnpm add @vasto/mysql-store
```

:::

```ts
import { MySQLQueueStorage } from '@vasto/mysql-store';

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
npm install @vasto/mongo-store
```

```sh [pnpm]
pnpm add @vasto/mongo-store
```

:::

```ts
import { MongoQueueStorage } from '@vasto/mongo-store';

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
npm install @vasto/dynamodb-store
```

```sh [pnpm]
pnpm add @vasto/dynamodb-store
```

:::

```ts
import { DynamoDBQueueStorage } from '@vasto/dynamodb-store';

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

- Package: `@vasto/mongo-store`
- Document-model fit for JSON-first environments

## DynamoDB

- Package: `@vasto/dynamodb-store`
- Cloud-native key-value storage on AWS

## Decision Tips

- Need raw queue latency at scale: Redis
- Need SQL and strong data governance: Postgres or MySQL
- Need local development with no external infra: In-memory or File
