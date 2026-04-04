import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        // barrel re-exports — no executable statements
        'src/index.ts',
        'src/libs/index.ts',
        'src/interfaces/index.ts',
        // pure TypeScript type files — emit no statements
        'src/types.ts',
        'src/interfaces/**/*.ts',
        // child-process / worker-thread entry points — only exercisable via
        // real thread/process pools; excluded from unit coverage intentionally
        'src/libs/isolation.ts',
        'src/libs/isolation-worker.ts',
        'src/libs/process-pool.ts',
        'src/libs/process-worker.ts',
        'src/libs/thread-pool.ts',
        'src/libs/thread-worker.ts',
        'src/libs/worker.ts',
        // runtime-resolver reads the filesystem for generated .vasto artifacts
        'src/libs/runtime-resolver.ts',
        // sandbox permanently mutates process globals (process.exit, child_process, fs, net)
        // — cannot be unit-tested without polluting the test process
        'src/libs/sandbox.ts',
      ],
      thresholds: {
        lines: 55,
        functions: 55,
        branches: 47,
        statements: 53,
      },
    },
  },
});
