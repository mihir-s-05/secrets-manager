import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  target: 'node20',
  platform: 'node',
  bundle: true,
  clean: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  outExtension: () => ({
    js: '.mjs',
  }),
  external: [
    'ink',
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-reconciler',
    'scheduler',
  ],
});
