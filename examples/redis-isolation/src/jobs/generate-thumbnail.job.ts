import { Job } from '@vasto-queue/core';

export type GenerateThumbnailPayload = {
  videoId: string;
  sourcePath: string;
  outputPath: string;
};

export class GenerateThumbnailJob extends Job<GenerateThumbnailPayload> {
  static jobName = 'GenerateThumbnailJob';
  override jobName = GenerateThumbnailJob.jobName;

  override queue(): string {
    return 'thread-thumbnails';
  }

  override async handle(payload: GenerateThumbnailPayload): Promise<{ thumbnailPath: string }> {
    console.log(`[thread] Generating thumbnail for ${payload.videoId}`);

    const cpuCost = simulateCpuWork(8_000_000);
    await sleep(250);

    console.log(`[thread] Thumbnail complete for ${payload.videoId} (cpu score=${cpuCost})`);

    return { thumbnailPath: `${payload.outputPath}/${payload.videoId}.jpg` };
  }
}

function simulateCpuWork(iterations: number): number {
  let value = 0;
  for (let index = 0; index < iterations; index += 1) {
    value += Math.sqrt((index % 1000) + 1);
  }
  return Math.round(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
