import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      enabled: false,
    },
  },
  esbuild: {
    target: 'node20',
    format: 'esm',
  },
});
