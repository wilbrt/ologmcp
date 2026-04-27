#!/usr/bin/env npx tsx
/**
 * Cleanup script to remove duplicate domain elements from the olog.
 * 
 * When domain discovery sessions are run multiple times, duplicate domain
 * elements can be created for the same code element. This script finds
 * duplicates and keeps the canonical one (the one with the most arrows),
 * deleting the rest.
 * 
 * The olog_arr table has ON DELETE CASCADE, so deleting elements will
 * automatically remove orphaned arrows.
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';

const DB_PATH = join(process.cwd(), '.olog', 'olog.sqlite');

interface ElemRow {
  id: string;
  kind: string;
  name: string;
  module: string | null;
  span: string | null;
  attrs: string;
}

interface ArrRow {
  id: string;
  kind: string;
  src_id: string;
  dst_id: string;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log(`Opening database: ${DB_PATH}`);
  const db = new Database(DB_PATH);

  // Find all domain elements
  const domainElems = db.prepare(
    `SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE kind = 'domain'`
  ).all() as ElemRow[];

  console.log(`Found ${domainElems.length} domain elements`);

  // Group by codeElementId
  const byCodeElementId = new Map<string, ElemRow[]>();
  for (const elem of domainElems) {
    let attrs: Record<string, unknown>;
    try {
      attrs = JSON.parse(elem.attrs);
    } catch {
      continue;
    }
    const codeElementId = attrs.codeElementId as string | undefined;
    if (!codeElementId) {
      console.log(`  Skipping ${elem.id} (${elem.name}) - no codeElementId`);
      continue;
    }
    if (!byCodeElementId.has(codeElementId)) {
      byCodeElementId.set(codeElementId, []);
    }
    byCodeElementId.get(codeElementId)!.push(elem);
  }

  // Find groups with duplicates
  let totalDuplicates = 0;
  let totalDeleted = 0;
  const idsToDelete: string[] = [];

  for (const [codeElementId, group] of byCodeElementId) {
    if (group.length <= 1) continue;
    totalDuplicates += group.length - 1;

    // For each element in the group, count outgoing + incoming arrows
    const scored = group.map(elem => {
      const outgoing = db.prepare(
        `SELECT COUNT(*) as cnt FROM olog_arr WHERE src_id = ?`
      ).get(elem.id) as { cnt: number };
      const incoming = db.prepare(
        `SELECT COUNT(*) as cnt FROM olog_arr WHERE dst_id = ?`
      ).get(elem.id) as { cnt: number };
      return {
        ...elem,
        arrowCount: outgoing.cnt + incoming.cnt,
      };
    });

    // Sort by arrow count descending — keep the one with most arrows
    scored.sort((a, b) => b.arrowCount - a.arrowCount);
    const canonical = scored[0];
    const duplicates = scored.slice(1);

    console.log(`  Code element: ${codeElementId}`);
    console.log(`    KEEP: ${canonical.id} (${canonical.name}) - ${canonical.arrowCount} arrows`);
    for (const dup of duplicates) {
      console.log(`    DELETE: ${dup.id} (${dup.name}) - ${dup.arrowCount} arrows`);
      idsToDelete.push(dup.id);
    }
  }

  if (idsToDelete.length === 0) {
    console.log('No duplicates found. Nothing to do.');
    db.close();
    return;
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Would delete ${idsToDelete.length} duplicate domain elements`);
    console.log('[DRY RUN] No changes were made to the database.');
    db.close();
    return;
  }

  console.log(`\nWill delete ${idsToDelete.length} duplicate domain elements (out of ${totalDuplicates + byCodeElementId.size} groups)`);

  // Delete in a transaction
  const deleteStmt = db.prepare(`DELETE FROM olog_elem WHERE id = ?`);
  const transaction = db.transaction(() => {
    for (const id of idsToDelete) {
      deleteStmt.run(id);
      totalDeleted++;
    }
  });

  transaction();
  console.log(`Deleted ${totalDeleted} duplicate domain elements`);

  // Verify
  const remaining = db.prepare(
    `SELECT COUNT(*) as cnt FROM olog_elem WHERE kind = 'domain'`
  ).get() as { cnt: number };
  console.log(`Remaining domain elements: ${remaining.cnt}`);

  db.close();
}

main();
