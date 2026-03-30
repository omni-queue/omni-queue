import { IsolationType } from '../types';

export interface WorkerConfig {
  queues: string[];
  concurrency: number;
  region?: string;
  balancing?: 'round-robin' | 'least-loaded';
  isolation?: IsolationType;
  /** Required for thread/process isolation. Not used when isolation is 'inline'. */
  workerModule?: string;
  poolSize?: number;
  registryModule?: string;
  pluginsModule?: string;
  timeout?: number;
}

export function defineWorkers(configs: Record<string, WorkerConfig>) {
  return configs;
}
