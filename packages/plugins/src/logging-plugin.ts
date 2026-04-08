import type { Job, Plugin, StoredJob } from '@vasto-queue/core';

export interface LoggingPluginLogger {
    debug?(message: string, meta?: Record<string, unknown>): void;
    info?(message: string, meta?: Record<string, unknown>): void;
    warn?(message: string, meta?: Record<string, unknown>): void;
    error?(message: string, meta?: Record<string, unknown>): void;
}

export interface LoggingPluginOptions {
    logger?: LoggingPluginLogger;
    includePayload?: boolean;
    prefix?: string;
}

function buildMetaFromJob(job: Job | StoredJob, includePayload: boolean): Record<string, unknown> {
    const queue = 'queue' in job && typeof job.queue === 'function' ? job.queue() : job.queue;
    const jobName = 'jobName' in job ? job.jobName : job.name;

    const meta: Record<string, unknown> = {
        jobName,
        queue,
    };

    if ('id' in job) {
        meta.jobId = job.id;
        meta.attempts = job.attempts;
    }

    if (includePayload) {
        meta.payload = job.payload;
    }

    return meta;
}

export function LoggingPlugin(options: LoggingPluginOptions = {}): Plugin {
    const logger = options.logger ?? console;
    const includePayload = options.includePayload ?? false;
    const prefix = options.prefix ?? '[vasto]';

    return {
        name: 'LoggingPlugin',
        async onEnqueue(job) {
            logger.info?.(`${prefix} enqueued job`, buildMetaFromJob(job, includePayload));
        },
        async onProcessStart(job) {
            logger.info?.(`${prefix} processing started`, buildMetaFromJob(job, includePayload));
        },
        async onProcessEnd(job, result) {
            const meta = buildMetaFromJob(job, includePayload);
            meta.result = result;
            logger.info?.(`${prefix} processing completed`, meta);
        },
        async onFail(job, error) {
            const meta = buildMetaFromJob(job, includePayload);
            meta.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
            logger.error?.(`${prefix} processing failed`, meta);
        },
    };
}
