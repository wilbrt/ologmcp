import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node'
  },
  external: [
    'better-sqlite3',
    'tree-sitter',
    'tree-sitter-typescript',
    '@modelcontextprotocol/sdk',
    'glob'
  ],
  noExternal: ['@olog/core']
});