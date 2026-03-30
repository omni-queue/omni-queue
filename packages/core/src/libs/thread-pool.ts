/* eslint-disable @typescript-eslint/no-explicit-any */
import { Worker } from 'worker_threads';
import { deserializeExecutionError } from './error-serialization';

type DeferredJob = {
    task: any;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
};

export class ThreadPool {
    private workers: Worker[] = [];
    private idle: Worker[] = [];
    private queue: DeferredJob[] = [];
    private currentJobs = new Map<Worker, DeferredJob>();

    constructor(workerModule: string, size: number = 4) {
        for (let i = 0; i < size; i++) {
            const worker = new Worker(workerModule, {
                stdout: true,
                stderr: true,
            });

            worker.on('message', (msg) => this.handleResult(worker, msg));
            worker.on('error', (err) => this.handleError(worker, err));

            this.pipeWorkerOutput(worker, i + 1);

            this.workers.push(worker);
            this.idle.push(worker);
        }
    }

    run(task: any): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
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
        worker.postMessage(job.task);
    }

    private handleResult(worker: Worker, msg: any) {
        const job = this.currentJobs.get(worker);
        if (!job) {
            return;
        }

        msg?.error ? job.reject(deserializeExecutionError(msg.error)) : job.resolve(msg.result);

        this.currentJobs.delete(worker);
        this.idle.push(worker);
        this.schedule();
    }

    private handleError(worker: Worker, err: any) {
        const job = this.currentJobs.get(worker);
        if (job) {
            job.reject(err);
            this.currentJobs.delete(worker);
        }

        this.idle.push(worker);
        this.schedule();
    }

    private pipeWorkerOutput(worker: Worker, workerId: number) {
        worker.stdout?.on('data', (chunk: Buffer) => {
            process.stdout.write(`[thread:${workerId}] ${chunk.toString()}`);
        });

        worker.stderr?.on('data', (chunk: Buffer) => {
            process.stderr.write(`[thread:${workerId}] ${chunk.toString()}`);
        });
    }
}
