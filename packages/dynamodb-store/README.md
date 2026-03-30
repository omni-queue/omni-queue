# `@omni-queue/dynamodb-store`

DynamoDB storage adapter for [Omni-Queue](../../README.md).

Uses AWS SDK v3 (`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`) for queue lifecycle operations and historical archive reads.

## Installation

```bash
npm install @omni-queue/dynamodb-store @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Usage

```ts
import { DynamoDbStore } from '@omni-queue/dynamodb-store';

const store = new DynamoDbStore({
  region: 'us-east-1',
  tableName: 'omni_queue_jobs',
  deadLetterTableName: 'omni_queue_dead_letter',
  completedTableName: 'omni_queue_completed',
});

await store.migrate();
```

## Features

- Queue lifecycle support (`enqueue`, `dequeue`, `ack`, `fail`, `extendLease`)
- Deferred jobs and promotion support
- Dead-letter queue and retry support
- Progress tracking
- Completed jobs archive with retention controls
