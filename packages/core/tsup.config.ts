import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: true,
  external: [
    'better-sqlite3',
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-clojure',
    'glob',
  ],
});
