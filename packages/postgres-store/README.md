# `@omni-queue/postgres-store`

PostgreSQL storage adapter for [Omni-Queue](../../README.md).

Uses `pg` under the hood with `FOR UPDATE SKIP LOCKED` for safe, concurrent job dequeuing without external locking.

## Installation

```bash
npm install @omni-queue/postgres-store pg
```

## Usage

```ts
import { PostgresStore } from '@omni-queue/postgres-store';

const store = new PostgresStore({
  pool: {
    host: 'localhost',
    port: 5432,
    database: 'myapp',
    user: 'postgres',
    password: 'secret',
  },
});

// Create tables on startup
await store.migrate();
```

Pass the store as a connection adapter to your queue config:

```ts
import { defineQueues, defineWorkers } from '@omni-queue/core';

const queues = defineQueues({
  default: {
    name: 'default',
    connection: 'postgres',
    concurrency: 5,
    batchSize: 10,
    retry: { attempts: 3, maxAttempts: 3, backoff: 'exponential' },
  },
});

const workers = defineWorkers({
  main: {
    queues: ['default'],
    concurrency: 2,
    workerModule: './worker-entry.js',
  },
});

const storageAdapters = { postgres: store };
```

## Schema

The adapter auto-creates two tables via `migrate()`:

| Table | Purpose |
|---|---|
| `omni_queue_jobs` | Active job queue |
| `omni_queue_dead_letter` | Exhausted / permanently failed jobs |

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `pool` | `Pool \| PoolConfig` | — | pg Pool instance or config object |
| `tableName` | `string` | `omni_queue_jobs` | Jobs table name |
| `deadLetterTableName` | `string` | `omni_queue_dead_letter` | Dead-letter table name |
