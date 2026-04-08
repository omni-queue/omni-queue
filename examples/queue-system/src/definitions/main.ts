import { defineIsolation } from '@vasto-queue/core';
import { TracingPlugin } from '@vasto-queue/otel-plugin';
import { CleanupJob, GenerateReportJob, SendEmailJob } from '../jobs/index.js';

export const { getRegistry, getPlugins } = defineIsolation({
  jobs: [SendEmailJob, GenerateReportJob, CleanupJob],
  plugins: [new TracingPlugin({ tracerName: 'main-isolation' })],
});
