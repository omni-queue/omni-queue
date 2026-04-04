# Contributing to vasto

Thanks for your interest in contributing to vasto.

This repository is an npm workspaces + Turbo monorepo. Please read this guide before opening an issue or pull request.

## Ways to contribute

- Report bugs with a minimal reproduction.
- Propose enhancements with concrete use cases.
- Improve documentation and examples.
- Submit code changes with tests.
- Review open pull requests.

## Before you start

1. Search existing issues and pull requests to avoid duplicates.
2. For non-trivial changes, open an issue first to align on scope.
3. Keep changes focused. Small, well-scoped PRs are reviewed faster.

## Development setup

### Prerequisites

- Node.js 18+
- npm 10+

### Install

```bash
npm install
```

### Build and test

```bash
# Build all workspaces
npm run build

# Type-check all workspaces
npm run check-types

# Run full test suite
npm test

# Integration tests (requires Redis + Postgres)
REDIS_TEST_URL=redis://localhost:6379 \
PG_TEST_URL=postgres://user:pass@localhost:5432/test \
RUN_INTEGRATION_TESTS=true \
npm run test:integration
```

### Useful focused commands

```bash
# Build core package only
npm --workspace @vasto/core run build

# Run focused core tests
npm --workspace @vasto/core run test -- <pattern>

# Dashboard local dev
cd packages/dashboard && npm run dev
```

## Monorepo structure

- `packages/core`: runtime source of truth (`Supervisor`, `JobManager`, worker runtime).
- `packages/*-adapter`: framework adapters.
- `packages/dashboard-api` and `packages/dashboard`: dashboard backend/frontend boundaries.
- `examples/*`: executable documentation and reference integrations.
- `docs/operations`: current operational and roadmap docs.

## Coding standards

- Use TypeScript and keep strict typing.
- Prefer small functions and explicit naming.
- Avoid unrelated refactors in the same PR.
- Preserve public API compatibility unless the change intentionally updates contracts.
- If behavior changes, add or update tests in `packages/core/tests` (or the relevant package tests).
- Keep examples runnable; they are treated as executable docs.

## Commit guidelines

- Use clear, imperative commit messages.
- Reference issue numbers when applicable (`Fixes #123`).
- Keep commits logically grouped and reviewable.

Example:

```text
core: add api/worker supervisor start mode
```

## Pull request checklist

Before opening a PR, verify:

- Code builds locally.
- Relevant tests pass.
- New behavior includes tests.
- Documentation and examples are updated when needed.
- PR description explains the problem, approach, and trade-offs.

## CI expectations

- `CI` (`.github/workflows/ci.yml`) runs build, typecheck, and tests for PRs and pushes targeting `main`.
- `Integration Tests` (`.github/workflows/integration-tests.yml`) runs on `main`-targeted PRs/pushes when core/Redis/Postgres integration paths change.
- Reproduce expected CI checks locally before opening your PR to reduce review turnaround.

## Testing expectations

- Bug fixes should include regression tests where feasible.
- Feature PRs should include positive-path and error-path coverage.
- For storage or adapter changes, test at least one runnable example that exercises the change.

## Documentation expectations

Update docs when changing:

- Public APIs in `@vasto/core`.
- Adapter behavior or setup.
- CLI commands or command behavior.
- Operational guidance in `docs/operations`.

For maintainers preparing releases, follow `docs/operations/releasing.md`.

## Reporting bugs

Use the Bug Report issue template and include:

- Environment details (Node, npm, OS).
- Minimal reproduction steps.
- Expected vs actual behavior.
- Relevant logs and stack traces.

## Security issues

Do not report security vulnerabilities in public issues.

Please follow `SECURITY.md` for responsible disclosure.

## License

By contributing, you agree that your contributions will be licensed under the repository's license terms.
