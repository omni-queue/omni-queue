# Releasing omni-queue

This guide describes the recommended release workflow for maintainers.

## Preconditions

- CI is green on the release branch.
- Working tree is clean except intended release changes.
- `CHANGELOG.md` has an updated `Unreleased` section.

## 1) Validate the monorepo

```bash
npm install
npm run build
npm run check-types
npm test

# Integration tests (requires Redis + Postgres)
REDIS_TEST_URL=redis://localhost:6379 \
PG_TEST_URL=postgres://user:pass@localhost:5432/test \
RUN_INTEGRATION_TESTS=true \
npm run test:integration
```

For focused validation while iterating:

```bash
npm --workspace @omni-queue/core run build
npm --workspace @omni-queue/core run test -- <pattern>
```

CI reference:

- `.github/workflows/ci.yml` is the baseline build/typecheck/test gate.
- `.github/workflows/integration-tests.yml` validates Redis/Postgres integration paths.

## 2) Prepare release notes

1. Move key entries from `Unreleased` to a new version heading in `CHANGELOG.md`.
2. Group notes into Added, Changed, Fixed, and Breaking (if applicable).
3. Include migration guidance for behavior or API changes.

## 3) Versioning

Use semver intentionally:

- `patch`: backward-compatible bug fixes
- `minor`: backward-compatible features
- `major`: breaking API/behavior changes

Update package versions according to your release tooling strategy.

## 4) Publish flow

1. Create and push a release branch or release commit.
2. Open PR and get approval.
3. Merge to the release target branch.
4. Tag the release (`vX.Y.Z`).
5. Publish packages to npm.
6. Create GitHub Release notes using the changelog entries.

## 5) Post-release checks

- Install newly published packages in a clean sample app.
- Run at least one adapter example end-to-end.
- Confirm docs links and quickstarts match released behavior.

## 6) Hotfix protocol

For urgent fixes:

1. Branch from latest release tag.
2. Keep patch scope minimal.
3. Re-run validation commands.
4. Publish a patch release.
5. Back-merge hotfix branch to the main development branch.
