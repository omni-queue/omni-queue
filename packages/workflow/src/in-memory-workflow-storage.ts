import type { WorkflowDefinition, WorkflowJob, WorkflowStorage } from './types';

export class InMemoryWorkflowStorage implements WorkflowStorage {
  private workflows = new Map<string, WorkflowDefinition>();
  private enqueuedJobs: WorkflowJob[] = [];

  async enqueue(job: WorkflowJob): Promise<void> {
    this.enqueuedJobs.push({ ...job });
  }

  async getWorkflow(workflowId: string): Promise<WorkflowDefinition> {
    const workflow = this.workflows.get(workflowId);

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    return {
      id: workflow.id,
      nodes: workflow.nodes.map((node) => ({
        ...node,
        dependsOn: node.dependsOn ? [...node.dependsOn] : [],
        job: { ...node.job },
      })),
    };
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    this.workflows.set(workflow.id, {
      id: workflow.id,
      nodes: workflow.nodes.map((node) => ({
        ...node,
        dependsOn: node.dependsOn ? [...node.dependsOn] : [],
        job: { ...node.job },
      })),
    });
  }

  getEnqueuedJobs(): WorkflowJob[] {
    return this.enqueuedJobs.map((job) => ({ ...job }));
  }

  takeEnqueuedJobs(): WorkflowJob[] {
    const jobs = this.getEnqueuedJobs();
    this.enqueuedJobs = [];
    return jobs;
  }

  clear(): void {
    this.workflows.clear();
    this.enqueuedJobs = [];
  }
}
