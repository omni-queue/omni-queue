# `@vasto/mysql-store`

MySQL storage adapter for [Vasto](../../README.md).

Uses `mysql2` with transactional dequeue and `FOR UPDATE SKIP LOCKED` for concurrent safe leasing on MySQL 8+.

## Installation

```bash
npm install @vasto/mysql-store mysql2
```

## Usage

```ts
import { MySqlStore } from '@vasto/mysql-store';

const store = new MySqlStore({
	pool: {
		uri: 'mysql://user:password@localhost:3306/mydb',
		connectionLimit: 10,
	},
});

await store.migrate();
```

## Features

- Queue lifecycle support (`enqueue`, `dequeue`, `ack`, `fail`, `extendLease`)
- Deferred jobs and promotion support
- Dead-letter queue and retry support
- Progress tracking
- Completed jobs archive with retention controls
