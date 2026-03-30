/* eslint-disable @typescript-eslint/no-explicit-any */
import { JobConstructor } from '../types';

export class JobRegistry {
  private map = new Map<string, any>();

  register(jobClass: JobConstructor) {
    const name = jobClass.jobName;

    if (!name) {
      throw new Error(`Job class ${name} must define static jobName`);
    }

    if (this.has(name)) {
      throw new Error(`Duplicate jobName: ${name}`);
    }

    this.map.set(name, jobClass);
  }

  registerAll(jobs: JobConstructor[]) {
    jobs.forEach((job) => this.register(job));
  }

  get(name: string) {
    const job = this.map.get(name);

    if (!job) {
      throw new Error(`Job not registered: ${name}`);
    }

    return job;
  }

  has(name: string) {
    return this.map.has(name);
  }
}

export const registry = new JobRegistry();
