/* eslint-disable @typescript-eslint/no-explicit-any */
import { parentPort, workerData } from 'worker_threads';
import { registry } from './registry';

async function run() {
  try {
    const { jobName, payload } = workerData;

    const JobClass = registry.get(jobName);
    const instance = new JobClass(payload);

    const result = await instance.handle(payload);

    parentPort?.postMessage({ result });
  } catch (err: any) {
    parentPort?.postMessage({ error: err.message });
  }
}

run();
