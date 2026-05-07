import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectLanguages } from './detect.js';
import AGENT_INGESTION from './prompts/olog-ingestion.txt';
import AGENT_PLANNING from './prompts/olog-planning.txt';
import AGENT_EXPLORE from './prompts/olog-explore.txt';
import AGENT_EDIT from './prompts/olog-edit.txt';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runInit(): Promise<void> {
  const root = process.cwd();

  console.log('olog-mcp init\n');

  // 1. Detect languages
  const languages = detectLanguages(root);
  console.log(`Detected languages: ${languages.join(', ')}`);

  // 2. Write agent files
  const agentsDir = join(root, '.opencode', 'agents');
  mkdirSync(agentsDir, { recursive: true });

  const agents: Array<{ file: string; content: string }> = [
    { file: 'olog-ingestion.md', content: AGENT_INGESTION },
    { file: 'olog-planning.md', content: AGENT_PLANNING },
    { file: 'olog-explore.md', content: AGENT_EXPLORE },
    { file: 'olog-edit.md', content: AGENT_EDIT },
  ];

  for (const agent of agents) {
    const dest = join(agentsDir, agent.file);
    writeFileSync(dest, agent.content);
    console.log(`  wrote ${dest.replace(root + '/', '')}`);
  }

  // 3. Merge opencode.json
  const configPath = join(root, 'opencode.json');
  const existing: Record<string, unknown> = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8'))
    : {};

  const patch: Record<string, unknown> = {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      olog: {
        type: 'local',
        command: ['npx', '-y', '-p', '@olog/mcp-server', 'olog-mcp'],
        environment: { OLOG_LANGUAGES: languages.join(',') },
        enabled: true,
      },
      'olog-mining': {
        type: 'local',
        command: ['npx', '-y', '-p', '@olog/mcp-server', 'olog-mcp-mining'],
        environment: { OLOG_LANGUAGES: languages.join(',') },
        enabled: true,
      },
    },
  };

  const updated = deepMerge(existing, patch);
  writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n');
  console.log(`  wrote opencode.json`);

  console.log(`
Done! Next steps:
  1. Commit .opencode/agents/ and opencode.json so teammates get the agents automatically.
  2. Open your project in opencode — the olog MCP server starts automatically.
  3. Use @olog-ingestion to begin domain modeling your codebase.
`);
}
