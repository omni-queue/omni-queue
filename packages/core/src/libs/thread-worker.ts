/* eslint-disable @typescript-eslint/no-explicit-any */
import { parentPort, workerData } from 'worker_threads';

async function run() {
  try {
    const { registryPath, data } = workerData;

    const { getRegistry } = await import(registryPath);
    const registry = getRegistry();

    const JobClass = registry.get(data.jobName);
    const instance = new JobClass(data.payload);

    const result = await instance.handle(data.payload);

    parentPort?.postMessage({ result });
  } catch (err: any) {
    parentPort?.postMessage({
      error: err.message || String(err),
    });
  }
}

run();
