import { Job } from '@vasto-queue/core';

export class NextEmailJob extends Job<{ to: string; subject: string; body: string }> {
  static jobName = 'next-email';
  override jobName = NextEmailJob.jobName;

  override queue() {
    return 'emails';
  }

  override async handle(payload: { to: string; subject: string; body: string }) {
    return { queuedFrom: 'next', to: payload.to, subject: payload.subject };
  }
}
