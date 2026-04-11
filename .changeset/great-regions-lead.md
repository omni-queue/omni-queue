---
'@vasto-queue/express-adapter': major
'@vasto-queue/fastify-adapter': major
'@vasto-queue/dynamodb-store': major
'@vasto-queue/elysia-adapter': major
'@vasto-queue/postgres-store': major
'@vasto-queue/dashboard-api': major
'@vasto-queue/hono-adapter': major
'@vasto-queue/nest-adapter': major
'@vasto-queue/next-adapter': major
'@vasto-queue/mongo-store': major
'@vasto-queue/mysql-store': major
'@vasto-queue/otel-plugin': major
'@vasto-queue/redis-store': major
'@vasto-queue/dashboard': major
'@vasto-queue/workflow': major
'@vasto-queue/metrics': major
'@vasto-queue/plugins': major
'@vasto-queue/core': major
'@vasto-queue/cli': major
---

Initial Release

### Added

- Initial public release of the Vasto queue ecosystem under the `@vasto-queue/*` namespace.
- Core runtime in `@vasto-queue/core` with queue orchestration, worker lifecycle management, retries, and scheduling primitives.
- First-party CLI in `@vasto-queue/cli` for project scaffolding, job generation, monitoring helpers, and dashboard publishing.
- First-party dashboard stack:
	- `@vasto-queue/dashboard` for the frontend UI.
	- `@vasto-queue/dashboard-api` for API handlers, auth integration points, and realtime transport plumbing.

### Storage Adapters

- Redis adapter via `@vasto-queue/redis-store`.
- Postgres adapter via `@vasto-queue/postgres-store`.
- MySQL adapter via `@vasto-queue/mysql-store`.
- MongoDB adapter via `@vasto-queue/mongo-store`.
- DynamoDB adapter via `@vasto-queue/dynamodb-store`.

### Framework Integrations

- Express integration via `@vasto-queue/express-adapter`.
- Fastify integration via `@vasto-queue/fastify-adapter`.
- Hono integration via `@vasto-queue/hono-adapter`.
- Nest integration via `@vasto-queue/nest-adapter`.
- Next.js integration via `@vasto-queue/next-adapter`.
- Elysia integration via `@vasto-queue/elysia-adapter`.

### Observability and Extensions

- Metrics package via `@vasto-queue/metrics`.
- OpenTelemetry plugin via `@vasto-queue/otel-plugin`.
- Workflow and plugin support packages via `@vasto-queue/workflow` and `@vasto-queue/plugins`.

### Notes

- This release establishes the baseline public API and package lineup for future semver-tracked updates.
- Versioning and changelog generation are managed through Changesets for subsequent releases.
