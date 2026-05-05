import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/index-mining.ts', 'src/index-init.ts'],
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
    'tree-sitter-clojure',
    '@modelcontextprotocol/sdk',
    '@olog/lang-typescript',
    '@olog/lang-clojure',
    'glob'
  ],
  noExternal: ['@olog/core']
});