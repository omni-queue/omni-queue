# `@vasto/dynamodb-store`

DynamoDB storage adapter for [Vasto](../../README.md).

Uses AWS SDK v3 (`@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`) for queue lifecycle operations and historical archive reads.

## Installation

```bash
npm install @vasto/dynamodb-store @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

## Usage

```ts
import { DynamoDbStore } from '@vasto/dynamodb-store';

const store = new DynamoDbStore({
  region: 'us-east-1',
  tableName: 'vasto_jobs',
  deadLetterTableName: 'vasto_dead_letter',
  completedTableName: 'vasto_completed',
});

await store.migrate();
```

## Features

- Queue lifecycle support (`enqueue`, `dequeue`, `ack`, `fail`, `extendLease`)
- Deferred jobs and promotion support
- Dead-letter queue and retry support
- Progress tracking
- Completed jobs archive with retention controls
