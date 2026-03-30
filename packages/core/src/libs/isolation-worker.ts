/* eslint-disable @typescript-eslint/no-explicit-any */
import { isMainThread, parentPort, workerData } from 'worker_threads';
import { Plugin } from '../interfaces/plugin';
import { StoredJob } from '../types';

type IsolationTask = {
    data: {
        jobName: string;
        payload: any;
        job?: StoredJob;
    };
    registryModule?: string;
    pluginsModule?: string;
};

async function loadRegistry(modulePath?: string) {
    if (!modulePath) {
        throw new Error('registryModule is required for thread/process isolation');
    }

    const mod = await import(modulePath);

    if (typeof mod.getRegistry === 'function') {
        return mod.getRegistry();
    }

    if (mod.registry?.get) {
        return mod.registry;
    }

    if (mod.default?.get) {
        return mod.default;
    }

    throw new Error(`Invalid registry module: ${modulePath}`);
}

async function loadPlugins(modulePath?: string): Promise<Plugin[]> {
    if (!modulePath) {
        return [];
    }

    const mod = await import(modulePath);

    if (typeof mod.getPlugins === 'function') {
        const loaded = mod.getPlugins();
        return Array.isArray(loaded) ? loaded : [];
    }

    if (Array.isArray(mod.plugins)) {
        return mod.plugins;
    }

    if (Array.isArray(mod.default)) {
        return mod.default;
    }

    return [];
}

function buildHookJob(task: IsolationTask, fallbackJobId: string): StoredJob {
    const now = Date.now();

    return (
        task.data.job ?? {
            id: fallbackJobId,
            name: task.data.jobName,
            payload: task.data.payload,
            queue: 'default',
            attempts: 0,
            state: 'processing',
            createdAt: now,
            updatedAt: now,
        }
    );
}

async function execute(task: IsolationTask) {
    const registry = await loadRegistry(task.registryModule);
    const plugins = await loadPlugins(task.pluginsModule);

    const JobClass = registry.get(task.data.jobName);
    if (!JobClass) {
        return { error: `Job not registered: ${task.data.jobName}` };
    }

    const instance = new JobClass(task.data.payload);
    const hookJob = buildHookJob(task, `${task.data.jobName}:${Date.now()}`);

    try {
        for (const plugin of plugins) {
            await plugin.onProcessStart?.(hookJob);
        }

        const result = await instance.handle(task.data.payload);

        for (const plugin of plugins) {
            await plugin.onProcessEnd?.(hookJob, result);
        }

        return { result };
    } catch (err: any) {
        for (const plugin of plugins) {
            await plugin.onFail?.(hookJob, err as Error);
        }

        return { error: err?.message || String(err) };
    }
}

if (!isMainThread && parentPort) {
    parentPort.on('message', async (task: IsolationTask) => {
        const res = await execute(task);
        parentPort!.postMessage(res);
    });

    if (workerData) {
        execute(workerData as IsolationTask).then((res) => parentPort!.postMessage(res));
    }
}

if (typeof process.send === 'function') {
    process.on('message', async (task: IsolationTask) => {
        const res = await execute(task);
        process.send?.(res);
    });
}
