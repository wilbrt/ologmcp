import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MotifCandidate, MotifSessionData } from './types.js';

interface SessionRow {
  id: string;
  status: string;
  scope_regex: string | null;
  candidates_json: string;
  commit_sha: string;
  created_at: number;
  updated_at: number;
}

export class MotifSessionStore {
  private readonly insertStmt: Database.Statement;
  private readonly getStmt: Database.Statement;
  private readonly listStmt: Database.Statement;
  private readonly updateStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO olog_motif_session
         (id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.getStmt = this.db.prepare(
      `SELECT id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at
       FROM olog_motif_session WHERE id = ?`,
    );
    this.listStmt = this.db.prepare(
      `SELECT id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at
       FROM olog_motif_session ORDER BY created_at DESC`,
    );
    this.updateStmt = this.db.prepare(
      `UPDATE olog_motif_session
       SET status = ?, scope_regex = ?, candidates_json = ?, updated_at = ?
       WHERE id = ?`,
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM olog_motif_session WHERE id = ?`);
  }

  create(data: {
    scopeRegex?: string;
    candidates: MotifCandidate[];
    commitSha: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.insertStmt.run(
      id,
      'active',
      data.scopeRegex ?? null,
      JSON.stringify(data.candidates),
      data.commitSha,
      now,
      now,
    );
    return id;
  }

  get(id: string): MotifSessionData | null {
    const row = this.getStmt.get(id) as SessionRow | undefined;
    if (!row) return null;
    return this.rowToSession(row);
  }

  list(): MotifSessionData[] {
    const rows = this.listStmt.all() as SessionRow[];
    return rows.map(r => this.rowToSession(r));
  }

  update(id: string, data: Partial<MotifSessionData>): void {
    const current = this.get(id);
    if (!current) throw new Error(`Motif session not found: ${id}`);

    const merged: MotifSessionData = { ...current, ...data };
    this.updateStmt.run(
      merged.status,
      merged.scopeRegex,
      JSON.stringify(merged.candidates),
      Date.now(),
      id,
    );
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }

  private rowToSession(row: SessionRow): MotifSessionData {
    return {
      id: row.id,
      status: row.status as MotifSessionData['status'],
      scopeRegex: row.scope_regex,
      candidates: JSON.parse(row.candidates_json) as MotifCandidate[],
      commitSha: row.commit_sha,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}