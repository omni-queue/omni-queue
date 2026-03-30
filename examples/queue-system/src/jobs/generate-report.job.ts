import { Job } from '@omni-queue/core';

export interface GenerateReportPayload {
  reportId: string;
  period: 'daily' | 'weekly' | 'monthly';
}

export class GenerateReportJob extends Job<GenerateReportPayload> {
  static jobName = 'GenerateReportJob';
  override jobName = GenerateReportJob.jobName;

  override queue(): string {
    return 'reports';
  }

  override tags(): string[] {
    return ['domain:analytics', `period:${this.payload.period}`, `report:${this.payload.reportId}`];
  }

  override async handle(payload: GenerateReportPayload): Promise<{ reportId: string; status: string }> {
    console.log(`[GenerateReportJob] generating ${payload.period} report: ${payload.reportId}`);
    return {
      reportId: payload.reportId,
      status: 'generated',
    };
  }
}
