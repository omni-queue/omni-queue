# Phase 2: Observability and Dashboard

## Objective

Provide first-class operational visibility, metrics, and dashboard workflows for queue monitoring and job triage.

## Scope

### 2.1 Metrics Collection and Export

- `@vasto-queue/metrics` package
- Prometheus client integration
- StatsD and DataDog exporters
- Auto-collected runtime metrics (queue depth, duration, failures)

### 2.2 Web Dashboard (MVP)

- React + Tailwind dashboard UI
- Queue overview and health views
- Job browser with filtering
- Failed-job triage and retry controls
- Real-time updates (SSE/WebSocket)
- Worker scaling controls

### 2.3 Job Archive and Audit

- SQL-based job archive support
- Configurable retention policies
- Query interfaces for historical analysis

## Status

- 2.1 Metrics Collection and Export: done
- 2.2 Web Dashboard (MVP): done
- 2.3 Job Archive and Audit: done

## Related references

- `docs/operations/feature-catalog.md`
- `docs/operations/quickstarts/dashboard-integration.md`
- `packages/dashboard`
- `packages/dashboard-api`
