import { Job } from '@omni-queue/core';

export interface CleanupPayload {
  path: string;
}

export class CleanupJob extends Job<CleanupPayload> {
  static jobName = 'CleanupJob';
  override jobName = CleanupJob.jobName;

  override queue(): string {
    return 'maintenance';
  }

  override tags(): string[] {
    return ['domain:ops', 'category:cleanup'];
  }

  override async handle(payload: CleanupPayload): Promise<{ cleaned: string }> {
    console.log(`[CleanupJob] cleaning resources at ${payload.path}`);
    return {
      cleaned: payload.path,
    };
  }
}
