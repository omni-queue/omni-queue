import fs from 'node:fs';
import path from 'node:path';

export type RuntimeModules = {
  /** Path to the shared isolation-worker.js entry point in .vasto/runtime */
  isolationWorkerModule: string;
  /**
   * Path to the compiled definition module (.vasto/runtime/<name>.js).
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
 * Resolves runtime module paths from the generated .vasto/runtime directory.
 *
 * @param name - Optional definition name (e.g. 'transcoder'). Maps to .vasto/runtime/<name>.js
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
  const vastoRuntimeDir = locateVastoRuntime();
  const isolationWorkerModule = path.join(vastoRuntimeDir, 'isolation-worker.js');

  if (!name) {
    return { isolationWorkerModule };
  }

  const definitionModuleCandidates = [
    path.join(vastoRuntimeDir, `${name}.js`),
    path.join(vastoRuntimeDir, 'definitions', `${name}.js`),
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

function locateVastoRuntime(): string {
  const cwd = process.cwd();
  const candidate = path.join(cwd, '.vasto', 'runtime');

  if (!fs.existsSync(candidate)) {
    fs.mkdirSync(candidate, { recursive: true });
  }

  return candidate;
}
