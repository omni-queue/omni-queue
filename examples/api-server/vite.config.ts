import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

const nodeExternals = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

export default defineConfig({
  build: {
    target: 'node18',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    ssr: true,
    rollupOptions: {
      input: {
        server: 'src/server.ts',
        worker: 'src/worker.ts',
      },
      external: (id: string) => {
        if (nodeExternals.has(id)) {
          return true;
        }

        return id.startsWith('@vasto/');
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
      },
    },
  },
});
