/* eslint-disable @typescript-eslint/no-explicit-any */
import { Job } from '../contracts/job';
import { StoredJob } from '../types';

export interface Plugin {
  name?: string;
  onEnqueue?(job: Job): Promise<void>;
  onProcessStart?(job: StoredJob): Promise<void>;
  onProcessEnd?(job: StoredJob, result: any): Promise<void>;
  onFail?(job: StoredJob, error: Error): Promise<void>;

  // Delayed/Scheduled job hooks (Phase 1.1)
  onJobDelayed?(job: Job, delayMs: number): Promise<void>;
  onJobPromoted?(job: StoredJob): Promise<void>;
  onScheduleCreated?(jobName: string, pattern: string): Promise<void>;

  // Priority hook (Phase 1.2)
  onJobPrioritized?(job: StoredJob): Promise<void>;

  // Progress hook (Phase 1.3)
  onProgress?(jobId: string, queueName: string, progress: number): Promise<void>;

  // DLQ hook (Phase 1.4)
  onFailedPermanently?(job: StoredJob, error: Error): Promise<void>;
}

