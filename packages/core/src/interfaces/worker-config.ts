import { IsolationType } from '../types';
import { QueueSandboxConfig } from './queue-config';

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
  consumerId?: string;
  sandbox?: QueueSandboxConfig;
}

export function defineWorkers(configs: Record<string, WorkerConfig>) {
  return configs;
}
