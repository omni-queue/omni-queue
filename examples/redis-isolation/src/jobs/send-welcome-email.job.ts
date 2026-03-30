import { Job } from '@omni-queue/core';

export type SendWelcomeEmailPayload = {
  to: string;
  subject: string;
  body: string;
};

export class SendWelcomeEmailJob extends Job<SendWelcomeEmailPayload> {
  static jobName = 'SendWelcomeEmailJob';
  override jobName = SendWelcomeEmailJob.jobName;

  override queue(): string {
    return 'inline-emails';
  }

  override async handle(payload: SendWelcomeEmailPayload): Promise<{ accepted: boolean }> {
    console.log(`[inline] Sending welcome email to ${payload.to} (${payload.subject})`);
    await sleep(120);
    console.log(`[inline] Email queued by SMTP provider: ${payload.to}`);
    return { accepted: true };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
