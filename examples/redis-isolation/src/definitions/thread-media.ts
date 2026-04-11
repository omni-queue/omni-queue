import { defineIsolation } from '@vasto-queue/core';
import { LoggingPlugin } from '@vasto-queue/plugins';
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
