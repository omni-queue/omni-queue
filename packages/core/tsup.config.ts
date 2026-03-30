import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/libs/isolation-worker.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
});
