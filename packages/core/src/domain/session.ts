import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DomainCandidate, DomainSessionData, ProposedEquation } from './types.js';
import { SessionStore } from '../session-store.js';

interface SessionRow {
  id: string;
  status: string;
  scope_regex: string | null;
  candidates_json: string;
  equations_json: string | null;
  commit_sha: string;
  created_at: number;
  updated_at: number;
}

const SELECT_COLUMNS = 'id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at';

export class DomainSessionStore extends SessionStore<SessionRow, DomainSessionData> {
  constructor(db: Database.Database) {
    super(
      db,
      `INSERT INTO olog_domain_session (id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      SELECT_COLUMNS,
      'olog_domain_session',
      `UPDATE olog_domain_session SET status = ?, scope_regex = ?, candidates_json = ?, equations_json = ?, updated_at = ? WHERE id = ?`,
    );
  }

  protected override rowToSession(row: SessionRow): DomainSessionData {
    return {
      id: row.id,
      status: row.status as DomainSessionData['status'],
      scopeRegex: row.scope_regex,
      candidates: JSON.parse(row.candidates_json) as DomainCandidate[],
      equations: row.equations_json ? (JSON.parse(row.equations_json) as ProposedEquation[]) : [],
      commitSha: row.commit_sha,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(data: { scopeRegex?: string; candidates: DomainCandidate[]; equations: ProposedEquation[]; commitSha: string }): string {
    const id = randomUUID();
    const now = Date.now();
    this.insertStmt.run(id, 'active', data.scopeRegex ?? null, JSON.stringify(data.candidates), JSON.stringify(data.equations), data.commitSha, now, now);
    return id;
  }

  update(id: string, data: Partial<DomainSessionData>): void {
    const current = this.get(id);
    if (!current) throw new Error(`Domain session not found: ${id}`);
    const merged: DomainSessionData = { ...current, ...data };
    this.updateStmt.run(merged.status, merged.scopeRegex, JSON.stringify(merged.candidates), JSON.stringify(merged.equations), Date.now(), id);
  }
}
