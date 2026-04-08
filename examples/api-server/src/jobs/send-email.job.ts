import { Job } from '@vasto-queue/core';

export interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

export class SendEmailJob extends Job<SendEmailPayload> {
  static jobName = 'ApiSendEmailJob';
  override jobName = SendEmailJob.jobName;

  override queue(): string {
    return 'api-jobs';
  }

  override async handle(payload: SendEmailPayload): Promise<{ accepted: boolean }> {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    console.log(`[ApiSendEmailJob] sending email to ${payload.to}: ${payload.subject}`);
    return { accepted: true };
  }
}
