import { randomUUID } from 'node:crypto';
import type {
  WorkflowDefinition,
  WorkflowJob,
  WorkflowNode,
  WorkflowNodeInput,
  WorkflowStorage,
} from './types';

export class WorkflowEngine {
  constructor(private readonly storage: WorkflowStorage) {}

  async run(nodes: WorkflowNodeInput[]): Promise<WorkflowDefinition> {
    const workflowId = this.resolveWorkflowId(nodes);
    const graph = this.buildGraph(nodes, workflowId);
    const workflow: WorkflowDefinition = {
      id: workflowId,
      nodes: Array.from(graph.values()),
    };

    const ready = this.getReadyNodes(graph);

    for (const node of ready) {
      node.status = 'queued';
      await this.storage.enqueue(node.job);
    }

    await this.storage.saveWorkflow(workflow);

    return workflow;
  }

  buildGraph(nodes: WorkflowNodeInput[], workflowId?: string): Map<string, WorkflowNode> {
    const resolvedWorkflowId = workflowId ?? this.resolveWorkflowId(nodes);
    const map = new Map<string, WorkflowNode>();

    for (const node of nodes) {
      if (map.has(node.id)) {
        throw new Error(`Duplicate workflow node id: ${node.id}`);
      }

      const dependsOn = [...(node.dependsOn ?? [])];
      const existingJob = node.job as Partial<WorkflowJob>;
      const job: WorkflowJob = {
        ...(node.job as WorkflowJob),
        workflowId: existingJob.workflowId ?? resolvedWorkflowId,
        workflowNodeId: existingJob.workflowNodeId ?? node.id,
      };

      map.set(node.id, {
        id: node.id,
        job,
        dependsOn,
        remaining: dependsOn.length,
        status: node.status ?? 'pending',
      });
    }

    for (const node of map.values()) {
      for (const dependencyId of node.dependsOn ?? []) {
        if (!map.has(dependencyId)) {
          throw new Error(
            `Workflow node ${node.id} depends on unknown node ${dependencyId}`
          );
        }
      }
    }

    return map;
  }

  getReadyNodes(graph: Map<string, WorkflowNode>): WorkflowNode[] {
    return Array.from(graph.values()).filter((node) => node.remaining === 0);
  }

  async onJobComplete(job: WorkflowJob): Promise<void> {
    const workflow = await this.storage.getWorkflow(job.workflowId);
    const completedNode = workflow.nodes.find((node) => node.id === job.workflowNodeId);

    if (!completedNode) {
      throw new Error(
        `Workflow node ${job.workflowNodeId} not found in workflow ${job.workflowId}`
      );
    }

    completedNode.status = 'done';
    completedNode.remaining = 0;

    const dependents = workflow.nodes.filter((node) =>
      (node.dependsOn ?? []).includes(job.workflowNodeId)
    );

    for (const dependent of dependents) {
      dependent.remaining = Math.max(0, dependent.remaining - 1);

      if (dependent.remaining === 0 && dependent.status === 'pending') {
        dependent.status = 'queued';
        await this.storage.enqueue(dependent.job);
      }
    }

    await this.storage.saveWorkflow(workflow);
  }

  private resolveWorkflowId(nodes: WorkflowNodeInput[]): string {
    const workflowIds = nodes
      .map((node) => (node.job as Partial<WorkflowJob>).workflowId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (workflowIds.length === 0) {
      return randomUUID();
    }

    const uniqueIds = new Set(workflowIds);

    if (uniqueIds.size > 1) {
      throw new Error('All workflow jobs must use the same workflowId');
    }

    const [workflowId] = uniqueIds;

    if (!workflowId) {
      throw new Error('Failed to resolve workflowId');
    }

    return workflowId;
  }
}
