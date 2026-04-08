import { Job } from '@vasto-queue/core';
export class GenerateThumbnailJob extends Job {
    static jobName = 'GenerateThumbnailJob';
    jobName = GenerateThumbnailJob.jobName;
    queue() {
        return 'thread-thumbnails';
    }
    async handle(payload) {
        console.log(`[thread] Generating thumbnail for ${payload.videoId}`);
        const cpuCost = simulateCpuWork(8_000_000);
        await sleep(250);
        console.log(`[thread] Thumbnail complete for ${payload.videoId} (cpu score=${cpuCost})`);
        return { thumbnailPath: `${payload.outputPath}/${payload.videoId}.jpg` };
    }
}
function simulateCpuWork(iterations) {
    let value = 0;
    for (let index = 0; index < iterations; index += 1) {
        value += Math.sqrt((index % 1000) + 1);
    }
    return Math.round(value);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
