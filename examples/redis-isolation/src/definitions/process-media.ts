import { defineIsolation } from '@vasto/core';
import { LoggingPlugin } from '@vasto/plugins';
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
