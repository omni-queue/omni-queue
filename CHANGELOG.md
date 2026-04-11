# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project aims to follow Semantic Versioning.

- Keep a Changelog: https://keepachangelog.com/en/1.1.0/
- Semantic Versioning: https://semver.org/spec/v2.0.0.html

## [Unreleased]

### Initial Release

### Added

- Initial public release of the Vasto queue ecosystem under the `@vasto-queue/*` namespace.
- Core runtime in `@vasto-queue/core` with queue orchestration, worker lifecycle management, retries, scheduling, and lifecycle hooks.
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

### Project Setup and Governance

- Contribution and community health docs (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/SUPPORT.md`).
- GitHub issue forms for bug report, feature request, and support request.
- Pull request template and CODEOWNERS.

### Changed

- README documentation hub now links to contribution and security policies.
