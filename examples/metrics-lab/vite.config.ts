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
      input: { index: 'src/index.ts' },
      external: (id: string) => nodeExternals.has(id) || id.startsWith('@omni-queue/'),
      output: { format: 'es', entryFileNames: '[name].js' }
    }
  }
});
