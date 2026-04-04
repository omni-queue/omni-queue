import { defineIsolation } from '@vasto/core';
import { LoggingPlugin } from '@vasto/plugins';
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
