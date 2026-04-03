import { Job } from '@vasto/core';
export class TranscodeVideoJob extends Job {
    static jobName = 'TranscodeVideoJob';
    jobName = TranscodeVideoJob.jobName;
    queue() {
        return 'process-transcode';
    }
    retries() {
        return 2;
    }
    async handle(payload) {
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
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
