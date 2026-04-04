import { Job } from '@vasto/core';
export class SendEmailJob extends Job {
    static jobName = 'SendEmailJob';
    jobName = SendEmailJob.jobName;
    queue() {
        return 'emails';
    }
    async handle(payload) {
        console.log(`[SendEmailJob] sending email to ${payload.to}: ${payload.subject}`);
        return { accepted: true };
    }
}
