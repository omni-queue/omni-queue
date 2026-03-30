import { Job } from '@omni-queue/core';
export class CleanupJob extends Job {
    static jobName = 'CleanupJob';
    jobName = CleanupJob.jobName;
    queue() {
        return 'maintenance';
    }
    async handle(payload) {
        console.log(`[CleanupJob] cleaning resources at ${payload.path}`);
        return {
            cleaned: payload.path,
        };
    }
}
