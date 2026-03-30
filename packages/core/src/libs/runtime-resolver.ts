import fs from 'node:fs';
import path from 'node:path';

export type RuntimeModules = {
  /** Path to the shared isolation-worker.js entry point in .omni/runtime */
  isolationWorkerModule: string;
  /**
   * Path to the compiled definition module (.omni/runtime/<name>.js).
   * Exports getRegistry() — only present when the definition file has been generated.
   */
  registryModule?: string;
  /**
   * Same path as registryModule — definition files export both getRegistry and getPlugins.
   * Only present when the definition file has been generated.
   */
  runtimePluginsModule?: string;
};

/**
 * Resolves runtime module paths from the generated .omni/runtime directory.
 *
 * @param name - Optional definition name (e.g. 'transcoder'). Maps to .omni/runtime/<name>.js
 *
 * @example
 * // Single shared worker
 * const modules = resolveRuntimeModules();
 *
 * // Named definition (generated from src/definitions/transcoder.ts)
 * const modules = resolveRuntimeModules('transcoder');
 *
 * // Use in defineWorkers
 * defineWorkers({
 *   transcoderWorker: {
 *     queues: ['transcoder'],
 *     isolation: 'thread',
 *     workerModule: modules.isolationWorkerModule,
 *     registryModule: modules.registryModule,
 *     pluginsModule: modules.runtimePluginsModule,
 *   }
 * });
 */
export function resolveRuntimeModules(name?: string): RuntimeModules {
  const omniRuntimeDir = locateOmniRuntime();
  const isolationWorkerModule = path.join(omniRuntimeDir, 'isolation-worker.js');

  if (!name) {
    return { isolationWorkerModule };
  }

  const definitionModuleCandidates = [
    path.join(omniRuntimeDir, `${name}.js`),
    path.join(omniRuntimeDir, 'definitions', `${name}.js`),
  ];
  const definitionModule = definitionModuleCandidates.find((candidate) => fs.existsSync(candidate));

  if (!definitionModule) {
    return { isolationWorkerModule };
  }

  return {
    isolationWorkerModule,
    registryModule: definitionModule,
    runtimePluginsModule: definitionModule,
  };
}

function locateOmniRuntime(): string {
  const cwd = process.cwd();
  const candidate = path.join(cwd, '.omni', 'runtime');

  if (!fs.existsSync(candidate)) {
    fs.mkdirSync(candidate, { recursive: true });
  }

  return candidate;
}
