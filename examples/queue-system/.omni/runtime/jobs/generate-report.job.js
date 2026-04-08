import { Job } from '@vasto-queue/core';
export class GenerateReportJob extends Job {
    static jobName = 'GenerateReportJob';
    jobName = GenerateReportJob.jobName;
    queue() {
        return 'reports';
    }
    async handle(payload) {
        console.log(`[GenerateReportJob] generating ${payload.period} report: ${payload.reportId}`);
        return {
            reportId: payload.reportId,
            status: 'generated',
        };
    }
}
