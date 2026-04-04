# postgres-storage-lab

Postgres-backed storage example.

## What this example demonstrates

- Using `@vasto/postgres-store` as the queue backend
- Running `store.migrate()` on startup
- Wiring Postgres storage into `Supervisor`
- Dispatching and reading completed jobs from a database-backed queue

## Prerequisites

- A reachable Postgres instance
- `DATABASE_URL` set to a valid connection string

Example:

```bash
export DATABASE_URL=postgres://postgres:secret@127.0.0.1:5432/vasto
```

## Run

From repository root:

```bash
npm install
npm run build
```

Then run:

```bash
cd examples/postgres-storage-lab
npm run dev
```
