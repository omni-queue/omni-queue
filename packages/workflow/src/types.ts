import type { StoredJob } from '@omni-queue/core';

export type WorkflowNodeStatus = 'pending' | 'queued' | 'done' | 'failed';

export interface WorkflowJob extends StoredJob {
  workflowId: string;
  workflowNodeId: string;
}

export interface WorkflowNode {
  id: string;
  job: WorkflowJob;
  dependsOn?: string[];
  remaining: number;
  status: WorkflowNodeStatus;
}

export interface WorkflowNodeInput {
  id: string;
  job: StoredJob | WorkflowJob;
  dependsOn?: string[];
  status?: WorkflowNodeStatus;
}

export interface WorkflowDefinition {
  id: string;
  nodes: WorkflowNode[];
}

export interface WorkflowStorage {
  enqueue(job: WorkflowJob): Promise<void>;
  getWorkflow(workflowId: string): Promise<WorkflowDefinition>;
  saveWorkflow(workflow: WorkflowDefinition): Promise<void>;
}
