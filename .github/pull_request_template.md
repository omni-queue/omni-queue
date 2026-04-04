## Summary

Describe the problem and what this PR changes.

## Changes

- 
- 
- 

## Validation

List commands you ran and their results.

```bash
npm run check-types
npm run build
npm test
REDIS_TEST_URL=redis://127.0.0.1:6380 \
PG_TEST_URL=postgres://vasto:vasto@127.0.0.1:55432/vasto_test \
RUN_INTEGRATION_TESTS=true \
npm run test:integration
```

### Validation Results

- `npm run check-types`:
- `npm run build`:
- `npm test`:
- `npm run test:integration` (live Redis/Postgres):

### Validation Environment

- Node.js version:
- npm version:

If integration tests were skipped, explain why and include what environment prerequisites were missing.

## Impact

- [ ] No public API changes
- [ ] Public API changes (documented below)
- [ ] Breaking changes
- [ ] Runtime behavior changes
- [ ] Docs updated
- [ ] Examples updated

### Public API / behavior notes

If applicable, describe compatibility or migration implications.

### Risk / Rollback Notes

If this change impacts runtime behavior, describe known risks and rollback strategy.

## Checklist

- [ ] PR is scoped and focused.
- [ ] Tests were added or updated where appropriate.
- [ ] Existing tests pass locally for affected packages.
- [ ] Documentation was updated where needed.
- [ ] Related issue is linked (`Fixes #...`) when applicable.
