import { Job } from '@omni-queue/core';

export interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

export class SendEmailJob extends Job<SendEmailPayload> {
  static jobName = 'SendEmailJob';
  override jobName = SendEmailJob.jobName;

  override queue(): string {
    return 'emails';
  }

  override tags(): string[] {
    return ['channel:email', `recipient:${this.payload.to}`];
  }

  override async handle(payload: SendEmailPayload): Promise<{ accepted: boolean }> {
    console.log(`[SendEmailJob] sending email to ${payload.to}: ${payload.subject}`);
    return { accepted: true };
  }
}
