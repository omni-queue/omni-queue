import { defineIsolation } from '@omni-queue/core';
import { LoggingPlugin } from '@omni-queue/plugins';
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
