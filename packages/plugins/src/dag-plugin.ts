import type { JobNode, Plugin, StoredJob } from '@vasto-queue/core';

export class DAGPlugin implements Plugin {
  private jobNodes = new Map<string, JobNode>();

  async onProcessStart(job: StoredJob): Promise<void> {
    const node = this.jobNodes.get(job.id);

    if (node && !node.isReady()) {
      throw new Error('Job dependencies not satisfied');
    }
  }

  async onProcessEnd(job: StoredJob): Promise<void> {
    const node = this.jobNodes.get(job.id);

    if (node) {
      node.completed = true;
    }
  }

  registerNode(node: JobNode): void {
    this.jobNodes.set(node.job.id, node);
  }

  registerNodes(nodes: JobNode[]): void {
    for (const node of nodes) {
      this.registerNode(node);
    }
  }

  getNode(jobId: string): JobNode | undefined {
    return this.jobNodes.get(jobId);
  }

  clear(): void {
    this.jobNodes.clear();
  }
}
