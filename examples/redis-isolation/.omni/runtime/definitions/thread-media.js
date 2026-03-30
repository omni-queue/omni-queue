import { defineIsolation } from '@omni-queue/core';
import { LoggingPlugin } from '@omni-queue/plugins';
import { GenerateThumbnailJob } from '../jobs/generate-thumbnail.job.js';
export const { getRegistry, getPlugins } = defineIsolation({
    jobs: [GenerateThumbnailJob],
    plugins: [
        LoggingPlugin({
            prefix: '[thread-media]',
            includePayload: true,
        }),
    ],
});
