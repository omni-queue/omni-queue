# `@vasto-queue/workflow`

Workflow and DAG orchestration helpers for Vasto.

## Included exports

- `WorkflowEngine` — enqueues ready nodes and advances dependent jobs after completion
- `WorkflowNode` / `WorkflowDefinition` — workflow graph types
- `WorkflowStorage` — storage contract needed by the engine

## Usage

```ts
import { WorkflowEngine } from '@vasto-queue/workflow';

const engine = new WorkflowEngine(storage);
await engine.run(nodes);
```
