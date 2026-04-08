import { JobRegistry } from './registry';
import { JobConstructor } from '../types';
import { Plugin } from '../interfaces/plugin';

export type IsolationDefinitionInput = {
  jobs: JobConstructor[];
  plugins?: Plugin[];
};

/**
 * Defines a typed isolation boundary for a worker.
 * Used in definition files inside src/definitions/.
 *
 * @example
 * // src/definitions/transcoder.ts
 * import { defineIsolation } from '@vasto-queue/core';
 * import { TranscodeVideoJob } from '../jobs/transcode-video';
 * import { TracingPlugin } from '@vasto-queue/otel-plugin';
 *
 * export const { getRegistry, getPlugins } = defineIsolation({
 *   jobs: [TranscodeVideoJob],
 *   plugins: [new TracingPlugin({ tracerName: 'transcoder' })],
 * });
 */
export function defineIsolation(input: IsolationDefinitionInput) {
  return {
    getRegistry() {
      const registry = new JobRegistry();
      registry.registerAll(input.jobs);
      return registry;
    },
    getPlugins(): Plugin[] {
      return input.plugins ?? [];
    },
  };
}
