/* eslint-disable @typescript-eslint/no-explicit-any */
import { IsolationOptions, IsolationPayload } from '../interfaces';
import { ProcessPool } from './process-pool';
import { sandboxPolicySignature } from './sandbox';
import { ThreadPool } from './thread-pool';

const threadPools = new Map<string, ThreadPool>();
const processPools = new Map<string, ProcessPool>();

/**
 * Executes a job in isolation
 */
export async function runWithIsolation(
  options: IsolationOptions,
  data: IsolationPayload,
  registry: any
) {
  const timeoutMs = options.timeoutMs ?? 30000;

  if (options.type === 'inline') {
    const JobClass = registry.get(data.jobName);
    const instance = new JobClass(data.payload);

    return withTimeout(instance.handle(data.payload), timeoutMs);
  }

  if (options.type === 'thread') {
    let pool = threadPools.get(options.workerModule);
    if (!pool) {
      pool = new ThreadPool(options.workerModule, options.poolSize || 4);
      threadPools.set(options.workerModule, pool);
    }

    return withTimeout(
      pool.run({
        data,
        registryModule: options.registryModule,
        pluginsModule: options.pluginsModule,
      }),
      timeoutMs
    );
  }

  if (options.type === 'process') {
    const processPoolKey = `${options.workerModule}::${sandboxPolicySignature(options.sandbox)}`;
    let pool = processPools.get(processPoolKey);
    if (!pool) {
      pool = new ProcessPool(options.workerModule, options.poolSize || 2, options.sandbox);
      processPools.set(processPoolKey, pool);
    }

    return withTimeout(
      pool.run(
        {
          data,
          registryModule: options.registryModule,
          pluginsModule: options.pluginsModule,
        },
        {
          timeoutMs,
          ...(options.timeoutSignal ? { timeoutSignal: options.timeoutSignal } : {}),
        }
      ),
      timeoutMs
    );
  }

  throw new Error('Invalid isolation type');
}

function withTimeout(promise: Promise<any>, timeoutMs: number) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const error = new Error(`Timeout after ${timeoutMs}ms`);
      error.name = 'JobTimeoutError';
      reject(error);
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timeout);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}
