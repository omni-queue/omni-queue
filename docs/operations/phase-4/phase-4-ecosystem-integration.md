# Phase 4: Ecosystem and Integration

## Objective

Expand package ecosystem coverage, framework integrations, and CLI workflows needed for broad adoption.

## Scope

### 4.1 Official Adapters and Storage Coverage

- MySQL, Postgres, MongoDB, DynamoDB store packages

### 4.2 Framework Integrations

- Express adapter
- Next adapter
- Fastify adapter
- Nest adapter
- Hono adapter

### 4.3 CLI Tooling

- Project initialization
- Job/workflow/scheduled generators
- Monitoring and DLQ command surfaces

### 4.4 BullMQ Parity Gap Sprint (Pre-Phase 5)

- Durable repeatable jobs with restart recovery
- Idempotency and deduplication strategy
- Queue admin operations (`promote`, `remove`, `clean`, `obliterate`)
- Unified lifecycle event stream contract

## Status

- 4.1 Official adapters and storage coverage: done
- 4.2 Framework integrations: done
- 4.3 CLI tooling: done
- 4.4 BullMQ parity gap sprint: done

## Related references

- `docs/operations/quickstarts/README.md`
- `docs/operations/migration-guides/from-bullmq.md`
- `packages/cli`
- `packages/*-adapter`
