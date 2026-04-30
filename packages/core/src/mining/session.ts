import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MotifCandidate, MotifSessionData } from './types.js';
import { SessionStore } from '../session-store.js';

interface SessionRow {
  id: string;
  status: string;
  scope_regex: string | null;
  candidates_json: string;
  commit_sha: string;
  created_at: number;
  updated_at: number;
}

const SELECT_COLUMNS = 'id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at';

export class MotifSessionStore extends SessionStore<SessionRow, MotifSessionData> {
  constructor(db: Database.Database) {
    super(
      db,
      `INSERT INTO olog_motif_session (id, status, scope_regex, candidates_json, commit_sha, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      SELECT_COLUMNS,
      'olog_motif_session',
      `UPDATE olog_motif_session SET status = ?, scope_regex = ?, candidates_json = ?, updated_at = ? WHERE id = ?`,
    );
  }

  protected override rowToSession(row: SessionRow): MotifSessionData {
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

  create(data: { scopeRegex?: string; candidates: MotifCandidate[]; commitSha: string }): string {
    const id = randomUUID();
    const now = Date.now();
    this.insertStmt.run(id, 'active', data.scopeRegex ?? null, JSON.stringify(data.candidates), data.commitSha, now, now);
    return id;
  }

  update(id: string, data: Partial<MotifSessionData>): void {
    const current = this.get(id);
    if (!current) throw new Error(`Motif session not found: ${id}`);
    const merged: MotifSessionData = { ...current, ...data };
    this.updateStmt.run(merged.status, merged.scopeRegex, JSON.stringify(merged.candidates), Date.now(), id);
  }
}
