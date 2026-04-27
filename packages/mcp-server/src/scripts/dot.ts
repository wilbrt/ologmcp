#!/usr/bin/env tsx
import { join } from 'node:path';
import { OlogStore } from '@olog/core';

const projectRoot = process.env.OLOG_ROOT || process.cwd();
const dbPath = join(projectRoot, '.olog', 'olog.sqlite');
const store = new OlogStore(dbPath);

function dotId(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const additionalKinds = process.argv.slice(2);
const kinds = ['domain', ...additionalKinds];

const allElems = kinds.flatMap((kind) =>
  store.queryElements({ kind, limit: 10000 })
);

const elemIds = new Set(allElems.map((e) => e.id));

const lines: string[] = ['digraph olog {', '  rankdir=LR;', '  node [shape=box];', ''];

for (const elem of allElems) {
  const label = elem.module ? `${elem.name}\\n[${elem.module}]` : elem.name;
  lines.push(`  ${dotId(elem.id)} [label=${dotId(label)}];`);
}

lines.push('');

const seenArrows = new Set<string>();
for (const elem of allElems) {
  for (const arr of store.outgoing(elem.id)) {
    if (!elemIds.has(arr.dstId)) continue;
    if (seenArrows.has(arr.id)) continue;
    seenArrows.add(arr.id);
    lines.push(`  ${dotId(elem.id)} -> ${dotId(arr.dstId)} [label=${dotId(arr.kind)}];`);
  }
}

lines.push('}');

store.close();
process.stdout.write(lines.join('\n') + '\n');
