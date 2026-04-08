import { defineIsolation } from '@vasto-queue/core';
import { LoggingPlugin } from '@vasto-queue/plugins';
import { TranscodeVideoJob } from '../jobs/transcode-video.job.js';
export const { getRegistry, getPlugins } = defineIsolation({
    jobs: [TranscodeVideoJob],
    plugins: [
        LoggingPlugin({
            prefix: '[process-media]',
            includePayload: true,
        }),
    ],
});
