#!/usr/bin/env tsx
/**
 * Generates .opencode/agents/*.md from packages/mcp-server/src/prompts/*.txt.
 * Run with --check to exit 1 if any file is out of sync (used in CI).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const check = process.argv.includes('--check');

const promptsDir = resolve(fileURLToPath(import.meta.url), '../../prompts');
const agentsDir = resolve(fileURLToPath(import.meta.url), '../../../../../.opencode/agents');

const files = readdirSync(promptsDir).filter(f => f.endsWith('.txt'));
let drift = false;

for (const file of files) {
  const src = join(promptsDir, file);
  const dest = join(agentsDir, basename(file, '.txt') + '.md');
  const content = readFileSync(src, 'utf8');

  if (check) {
    let existing: string;
    try {
      existing = readFileSync(dest, 'utf8');
    } catch {
      console.error(`MISSING: ${dest}`);
      drift = true;
      continue;
    }
    if (existing !== content) {
      console.error(`OUT OF SYNC: ${dest}`);
      drift = true;
    }
  } else {
    writeFileSync(dest, content);
    console.log(`wrote ${dest}`);
  }
}

if (check && drift) {
  console.error('\nRun "npm run gen-agents" to regenerate from prompts/*.txt');
  process.exit(1);
}
if (check && !drift) {
  console.log('agents in sync');
}
