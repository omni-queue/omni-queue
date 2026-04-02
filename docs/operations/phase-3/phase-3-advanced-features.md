# Phase 3: Advanced Features

## Objective

Add advanced execution and orchestration behavior beyond basic queue lifecycle parity.

## Scope

### 3.1 Job Flows (DAG-based Workflows)

- JobFlow builder APIs
- Parent-child dependency tracking
- Atomic failure handling

### 3.2 Queue Pause/Resume with Drain

- Graceful queue pause and resume behavior
- Drain behavior for in-flight work
- Supervisor APIs for pause/resume lifecycle control

### 3.3 Job Timeout and Cancellation

- Per-job execution timers
- Signal handling for isolated process workers
- Configurable timeout strategy behavior

## Status

- 3.1 Job Flows: done
- 3.2 Queue Pause/Resume with Drain: done
- 3.3 Job Timeout and Cancellation: done

## Related references

- `examples/workflow-system`
- `examples/scheduling-lab`
- `examples/timeout-sandbox-lab`
- `packages/core/src/libs/worker-runtime.ts`
