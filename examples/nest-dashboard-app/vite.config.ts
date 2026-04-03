import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

const nodeExternals = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  '@nestjs/common',
  '@nestjs/core',
  'reflect-metadata',
  'rxjs',
  'express',
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
      input: { main: 'src/main.ts', worker: 'src/worker.ts' },
      external: (id: string) => nodeExternals.has(id) || id.startsWith('node:') || id.startsWith('@vasto/'),
      output: { format: 'es', entryFileNames: '[name].js' }
    }
  }
});
