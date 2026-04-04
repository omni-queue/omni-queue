import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

const nodeExternals = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  'next',
  'react',
  'react-dom',
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
        runtime: 'src/runtime.ts',
        dashboard: 'pages/api/vasto/[...vasto].ts',
        dashboardApi: 'pages/api/dashboard-api/[...dashboard-api].ts',
        dispatch: 'pages/api/jobs/email.ts',
        worker: 'src/worker.ts',
        home: 'pages/index.tsx'
      },
      external: (id: string) => nodeExternals.has(id) || id.startsWith('node:') || id.startsWith('next/') || id.startsWith('@vasto/'),
      output: { format: 'es', entryFileNames: '[name].js' }
    }
  }
});
