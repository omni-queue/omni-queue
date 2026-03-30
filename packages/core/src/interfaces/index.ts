/* eslint-disable @typescript-eslint/no-explicit-any */
import { IsolationType, StoredJob } from '../types';
import { QueueSandboxConfig } from './queue-config';

export interface IsolationPayload {
  jobName: string;
  payload: any;
  job?: StoredJob;
}

export interface IsolationOptions {
  type: IsolationType;
  timeoutMs?: number;
  timeoutSignal?: NodeJS.Signals;
  workerModule: string;
  poolSize?: number;
  registryModule?: string;
  pluginsModule?: string;
  sandbox?: QueueSandboxConfig;
}

export * from './queue-config';
export * from './worker-config';
export * from './queue-storage';
export * from './plugin';
export * from './dashboard';
export * from './retry-policy';
