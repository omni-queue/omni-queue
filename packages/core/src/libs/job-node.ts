import { StoredJob } from "../types";

export class JobNode {
  public children: JobNode[] = [];

  constructor(
    public job: StoredJob,
    public dependsOn: JobNode[] = []
  ) {
    dependsOn.forEach((dep) => dep.children.push(this));
  }

  isReady(): boolean {
    return this.dependsOn.every((d) => d.completed);
  }

  completed = false;
}
