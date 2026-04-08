import { Job } from '@vasto-queue/core';

export class ElysiaEmailJob extends Job<{ to: string; subject: string; body: string }> {
  static jobName = 'elysia-email';
  override jobName = ElysiaEmailJob.jobName;

  override queue() {
    return 'emails';
  }

  override async handle(payload: { to: string; subject: string; body: string }) {
    return { queuedFrom: 'elysia', to: payload.to, subject: payload.subject };
  }
}
