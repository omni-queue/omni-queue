import { Job } from '@vasto-queue/core';

export type TranscodeVideoPayload = {
  videoId: string;
  sourcePath: string;
  targetPath: string;
  profile: '1080p' | '720p' | '480p';
  segmentCount: number;
};

export class TranscodeVideoJob extends Job<TranscodeVideoPayload> {
  static jobName = 'TranscodeVideoJob';
  override jobName = TranscodeVideoJob.jobName;

  override queue(): string {
    return 'process-transcode';
  }

  override retries(): number {
    return 2;
  }

  override async handle(payload: TranscodeVideoPayload): Promise<{ outputManifest: string }> {
    console.log(`[process] Starting transcode for ${payload.videoId} (${payload.profile})`);

    await this.reportProgress(0);

    for (let segment = 1; segment <= payload.segmentCount; segment += 1) {
      await sleep(1500);
      console.log(`[process] ${payload.videoId}: transcoded segment ${segment}/${payload.segmentCount}`);
      await this.reportProgress(Math.round((segment / payload.segmentCount) * 95));
    }

    await sleep(1200);
    console.log(`[process] Finished transcode for ${payload.videoId}`);
    await this.reportProgress(100);

    return {
      outputManifest: `${payload.targetPath}/${payload.videoId}/manifest.m3u8`,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
