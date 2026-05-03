#!/usr/bin/env npx tsx
/**
 * Cleanup script to remove duplicate domain elements by name.
 * 
 * When domain discovery sessions are run multiple times, duplicate domain
 * elements can be created for the same concept with different IDs. This script
 * groups domain elements by name and keeps the canonical one (the one with the
 * most arrows), re-pointing all arrows from duplicates to the keeper, then
 * deleting the rest.
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

function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`Opening database: ${DB_PATH}`);
  const db = new Database(DB_PATH);

  const domainElems = db.prepare(
    `SELECT id, kind, name, module, span, attrs FROM olog_elem WHERE kind = 'domain'`
  ).all() as ElemRow[];

  console.log(`Found ${domainElems.length} domain elements`);

  const byName = new Map<string, ElemRow[]>();
  for (const elem of domainElems) {
    if (!byName.has(elem.name)) {
      byName.set(elem.name, []);
    }
    byName.get(elem.name)!.push(elem);
  }

  let totalDeleted = 0;
  const idsToDelete: string[] = [];

  for (const [name, group] of byName) {
    if (group.length <= 1) continue;

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

    scored.sort((a, b) => b.arrowCount - a.arrowCount);
    const canonical = scored[0];
    const duplicates = scored.slice(1);

    console.log(`  Name: "${name}"`);
    console.log(`    KEEP: ${canonical.id} - ${canonical.arrowCount} arrows`);
    for (const dup of duplicates) {
      console.log(`    DELETE: ${dup.id} - ${dup.arrowCount} arrows`);
      idsToDelete.push(dup.id);
    }

    // Re-point all arrows referencing duplicate IDs to the canonical ID
    for (const dup of duplicates) {
      if (dup.id === canonical.id) continue;

      // Update src_id in arrows
      const srcUpdate = db.prepare(
        `UPDATE olog_arr SET src_id = ? WHERE src_id = ?`
      );
      const srcResult = srcUpdate.run(canonical.id, dup.id);
      if (srcResult.changes > 0) {
        console.log(`    Re-pointed ${srcResult.changes} outgoing arrows from ${dup.id} → ${canonical.id}`);
      }

      // Update dst_id in arrows
      const dstUpdate = db.prepare(
        `UPDATE olog_arr SET dst_id = ? WHERE dst_id = ?`
      );
      const dstResult = dstUpdate.run(canonical.id, dup.id);
      if (dstResult.changes > 0) {
        console.log(`    Re-pointed ${dstResult.changes} incoming arrows from ${dup.id} → ${canonical.id}`);
      }
    }
  }

  if (idsToDelete.length === 0) {
    console.log('No duplicates found. Nothing to do.');
    db.close();
    return;
  }

  console.log(`\nWill delete ${idsToDelete.length} duplicate domain elements`);

  if (dryRun) {
    console.log('[DRY RUN] No changes were made to the database.');
    db.close();
    return;
  }

  const deleteStmt = db.prepare(`DELETE FROM olog_elem WHERE id = ?`);
  const transaction = db.transaction(() => {
    for (const id of idsToDelete) {
      deleteStmt.run(id);
      totalDeleted++;
    }
  });

  transaction();
  console.log(`Deleted ${totalDeleted} duplicate domain elements`);

  const remaining = db.prepare(
    `SELECT COUNT(*) as cnt FROM olog_elem WHERE kind = 'domain'`
  ).get() as { cnt: number };
  console.log(`Remaining domain elements: ${remaining.cnt}`);

  db.close();
}

main();