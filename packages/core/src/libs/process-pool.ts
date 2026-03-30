/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildProcess, fork } from 'child_process';
import { QueueSandboxConfig } from '../interfaces/queue-config';
import { deserializeExecutionError } from './error-serialization';
import { buildSandboxedChildEnv } from './sandbox';

type DeferredJob = {
    task: any;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeoutMs?: number;
    timeoutSignal?: NodeJS.Signals;
    timeoutHandle?: ReturnType<typeof setTimeout>;
};

export class ProcessPool {
    private workerModule: string;
    private size: number;
    private sandbox?: QueueSandboxConfig;
    private workers: ChildProcess[] = [];
    private idle: ChildProcess[] = [];
    private queue: DeferredJob[] = [];
    private currentJobs = new Map<ChildProcess, DeferredJob>();

    constructor(workerModule: string, size: number = 2, sandbox?: QueueSandboxConfig) {
        this.workerModule = workerModule;
        this.size = size;
        this.sandbox = sandbox;

        for (let i = 0; i < size; i++) {
            const child = this.createWorker(i + 1);
            this.workers.push(child);
            this.idle.push(child);
        }
    }

    run(task: any, options?: { timeoutMs?: number; timeoutSignal?: NodeJS.Signals }): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({
                task,
                resolve,
                reject,
                timeoutMs: options?.timeoutMs,
                timeoutSignal: options?.timeoutSignal,
            });
            this.schedule();
        });
    }

    private schedule() {
        if (!this.idle.length || !this.queue.length) {
            return;
        }

        const worker = this.idle.shift();
        const job = this.queue.shift();

        if (!worker || !job) {
            return;
        }

        this.currentJobs.set(worker, job);

        if (job.timeoutMs && job.timeoutMs > 0) {
            job.timeoutHandle = setTimeout(() => {
                this.handleTimeout(worker, job);
            }, job.timeoutMs);
        }

        worker.send(job.task);
    }

    private handleResult(worker: ChildProcess, msg: any) {
        const job = this.currentJobs.get(worker);
        if (!job) {
            return;
        }

        if (job.timeoutHandle) {
            clearTimeout(job.timeoutHandle);
        }

        msg?.error ? job.reject(deserializeExecutionError(msg.error)) : job.resolve(msg.result);

        this.currentJobs.delete(worker);
        this.idle.push(worker);
        this.schedule();
    }

    private handleError(worker: ChildProcess, err: any) {
        const job = this.currentJobs.get(worker);
        if (job) {
            if (job.timeoutHandle) {
                clearTimeout(job.timeoutHandle);
            }
            job.reject(err);
            this.currentJobs.delete(worker);
        }

        this.idle.push(worker);
        this.schedule();
    }

    private handleTimeout(worker: ChildProcess, job: DeferredJob) {
        if (!this.currentJobs.has(worker)) {
            return;
        }

        this.currentJobs.delete(worker);
        job.reject(new Error(`Timeout after ${job.timeoutMs}ms`));

        const signal = job.timeoutSignal ?? 'SIGTERM';
        try {
            worker.kill(signal);
        } catch {
            // best effort
        }

        this.removeWorker(worker);
        const replacement = this.createWorker(this.workers.length + 1);
        this.workers.push(replacement);
        this.idle.push(replacement);
        this.schedule();
    }

    private createWorker(workerId: number): ChildProcess {
        const child = fork(this.workerModule, [], {
            silent: true,
            env: buildSandboxedChildEnv(process.env, this.sandbox),
        });

        child.on('message', (msg) => this.handleResult(child, msg));
        child.on('error', (err) => this.handleError(child, err));
        child.on('exit', () => {
            this.removeWorker(child);
            if (this.workers.length < this.size) {
                const replacement = this.createWorker(this.workers.length + 1);
                this.workers.push(replacement);
                this.idle.push(replacement);
                this.schedule();
            }
        });

        this.pipeWorkerOutput(child, workerId);
        return child;
    }

    private removeWorker(worker: ChildProcess) {
        this.idle = this.idle.filter((w) => w !== worker);
        this.workers = this.workers.filter((w) => w !== worker);
        this.currentJobs.delete(worker);
    }

    private pipeWorkerOutput(worker: ChildProcess, workerId: number) {
        worker.stdout?.on('data', (chunk: Buffer) => {
            process.stdout.write(`[process:${workerId}] ${chunk.toString()}`);
        });

        worker.stderr?.on('data', (chunk: Buffer) => {
            process.stderr.write(`[process:${workerId}] ${chunk.toString()}`);
        });
    }
}
