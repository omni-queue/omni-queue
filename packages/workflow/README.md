# `@omni-queue/workflow`

Workflow and DAG orchestration helpers for Omni-Queue.

## Included exports

- `WorkflowEngine` — enqueues ready nodes and advances dependent jobs after completion
- `WorkflowNode` / `WorkflowDefinition` — workflow graph types
- `WorkflowStorage` — storage contract needed by the engine

## Usage

```ts
import { WorkflowEngine } from '@omni-queue/workflow';

const engine = new WorkflowEngine(storage);
await engine.run(nodes);
```
