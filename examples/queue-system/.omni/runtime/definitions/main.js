import { defineIsolation } from '@vasto/core';
import { TracingPlugin } from '@vasto/otel-plugin';
import { CleanupJob, GenerateReportJob, SendEmailJob } from '../jobs/index.js';
export const { getRegistry, getPlugins } = defineIsolation({
    jobs: [SendEmailJob, GenerateReportJob, CleanupJob],
    plugins: [new TracingPlugin({ tracerName: 'main-isolation' })],
});
