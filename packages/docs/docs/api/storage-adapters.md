---
title: Storage Adapters API
description: QueueStorage contract and constructor signatures for all Vasto storage adapters.
outline: deep
---

# Storage Adapters API

## QueueStorage contract

All adapters implement this interface. You only interact with it directly if you are building a custom adapter.

```ts
interface QueueStorage {
  // Core queue operations
  enqueue(job: StoredJob): Promise<void>;
  dequeue(options: LeaseOptions): Promise<StoredJob[]>;
  ack(jobId: string): Promise<void>;
  fail(jobId: string, err: Error): Promise<void>;
  moveToDeadLetter(job: StoredJob): Promise<void>;

  // Scheduling
  enqueueDeferred(job: StoredJob): Promise<void>;
  promoteDeferred(queueName: string, now: number): Promise<StoredJob[]>;

  // Admin / inspection
  listReady(query: ReadyJobsQuery): Promise<StoredJob[]>;
  listActive(query: ActiveJobsQuery): Promise<StoredJob[]>;
  listDeferred(query: DeferredJobsQuery): Promise<StoredJob[]>;
  listDeadLetter(query: DeadLetterQuery): Promise<StoredJob[]>;
  listCompleted(query: CompletedJobsQuery): Promise<CompletedJobRecord[]>;
  clean(options: QueueCleanOptions): Promise<number>;
}
```

::: tip Custom adapters
Implement every method in `QueueStorage` and pass an instance in `storageAdapters`. No base class is required.
:::

---

## InMemoryQueueStorage <Badge type="tip" text="@vasto-queue/core" />

```ts
import { InMemoryQueueStorage } from '@vasto-queue/core';

new InMemoryQueueStorage()
```

No arguments. State is lost when the process exits. **Not for production.**

---

## FileQueueStorage <Badge type="tip" text="@vasto-queue/core" />

```ts
import { FileQueueStorage } from '@vasto-queue/core';

new FileQueueStorage(dataDir?: string)
```

| Argument | Type | Default | Description |
|---|---|---|---|
| `dataDir` | `string` | `'./queue-data'` | Directory for JSON job files. Created automatically. |

Uses `fs.renameSync` for atomic cross-process claim semantics. No `migrate()` call needed.

---

## RedisQueueStorage <Badge type="tip" text="@vasto-queue/redis-store" />

```ts
import { RedisQueueStorage } from '@vasto-queue/redis-store';

new RedisQueueStorage(options)
```

| Option | Type | Description |
|---|---|---|
| `host` | `string` | Redis host |
| `port` | `number` | Redis port |
| `password` | `string?` | Auth password |
| `db` | `number?` | Database index |
| `tls` | `object?` | TLS options |

---

## PostgresQueueStorage <Badge type="tip" text="@vasto-queue/postgres-store" />

```ts
import { PostgresQueueStorage } from '@vasto-queue/postgres-store';

const storage = new PostgresQueueStorage({ connectionString: '...' });
await storage.migrate(); // must be called before supervisor.start()
```

| Option | Type | Description |
|---|---|---|
| `connectionString` | `string` | PostgreSQL connection URL |
| `schema` | `string?` | Schema name (default: `public`) |

---

## MySQLQueueStorage <Badge type="tip" text="@vasto-queue/mysql-store" />

```ts
import { MySQLQueueStorage } from '@vasto-queue/mysql-store';

const storage = new MySQLQueueStorage({ host, user, password, database });
await storage.migrate();
```

---

## MongoQueueStorage <Badge type="tip" text="@vasto-queue/mongo-store" />

```ts
import { MongoQueueStorage } from '@vasto-queue/mongo-store';

new MongoQueueStorage({ uri: '...', dbName: '...' })
```

| Option | Type | Description |
|---|---|---|
| `uri` | `string` | MongoDB connection string |
| `dbName` | `string` | Database name |

---

## DynamoDBQueueStorage <Badge type="tip" text="@vasto-queue/dynamodb-store" />

```ts
import { DynamoDBQueueStorage } from '@vasto-queue/dynamodb-store';

new DynamoDBQueueStorage({ region: '...', tableName: '...' })
```

| Option | Type | Description |
|---|---|---|
| `region` | `string` | AWS region |
| `tableName` | `string` | DynamoDB table name |
| `endpoint` | `string?` | Custom endpoint (for local DynamoDB) |
