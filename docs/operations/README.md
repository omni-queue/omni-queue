# Operations Documentation

This section is the operator and adopter entry point for Omni Queue.

It is organized to help three common audiences:

1. **Teams evaluating a migration from BullMQ**
2. **Developers integrating Omni Queue into an application framework**
3. **Operators preparing a production rollout**

## Start here

### Foundation and getting started

- [Implemented feature catalog](feature-catalog.md)
- [Phase 0: Core foundation](phase-1/phase-0-foundation.md)
- [Quick start guide](../../README.md)

### Migration and adoption

- [BullMQ migration guide](migration-guides/from-bullmq.md)
- [Adapter quickstarts](quickstarts/README.md)

### Production readiness

- [Roadmap](ROADMAP.md)
- [Phase 5 production readiness plan](phase-5/phase-5-proposal.md)
- [Incident playbooks](phase-5/incident-playbooks.md)
- [Capacity planning toolkit](phase-5/capacity-planning-toolkit.md)

### Architecture and APIs

- [Architecture docs](architecture/)
- [API reference docs](api-reference/)

## Recommended reading paths

### If you are migrating from BullMQ

1. Read the [implemented feature catalog](feature-catalog.md)
2. Read the [BullMQ migration guide](migration-guides/from-bullmq.md)
3. Pick the closest [adapter quickstart](quickstarts/README.md)
4. Generate starter code with the CLI:
   - `queue generate:api-job --name=send-email`
   - `queue generate:workflow --name=asset-pipeline`
   - `queue generate:scheduled --name=daily-digest`

### If you are starting a greenfield project

1. Read the root [README](../../README.md)
2. Review the [implemented feature catalog](feature-catalog.md)
3. Choose an adapter in [quickstarts](quickstarts/README.md)
4. Review [capacity planning](phase-5/capacity-planning-toolkit.md) before production rollout

### If you are operating Omni Queue in production

1. Review the [implemented feature catalog](feature-catalog.md)
2. Review the [phase 5 proposal](phase-5/phase-5-proposal.md)
3. Adopt the [incident playbooks](phase-5/incident-playbooks.md)
4. Use the [capacity planning toolkit](phase-5/capacity-planning-toolkit.md) for worker sizing

## Documentation goals

This documentation set is intended to be:

- **Actionable** for day-1 adoption
- **Migration-aware** for BullMQ users
- **Operator-friendly** for teams moving toward production
- **Incremental** so teams can adopt one queue or one workflow at a time
