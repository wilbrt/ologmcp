import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DomainCandidate, DomainSessionData, ProposedEquation } from './types.js';

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

export class DomainSessionStore {
  private readonly insertStmt: Database.Statement;
  private readonly getStmt: Database.Statement;
  private readonly listStmt: Database.Statement;
  private readonly updateStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO olog_domain_session
         (id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.getStmt = this.db.prepare(
      `SELECT id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at
       FROM olog_domain_session WHERE id = ?`,
    );
    this.listStmt = this.db.prepare(
      `SELECT id, status, scope_regex, candidates_json, equations_json, commit_sha, created_at, updated_at
       FROM olog_domain_session ORDER BY created_at DESC`,
    );
    this.updateStmt = this.db.prepare(
      `UPDATE olog_domain_session
       SET status = ?, scope_regex = ?, candidates_json = ?, equations_json = ?, updated_at = ?
       WHERE id = ?`,
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM olog_domain_session WHERE id = ?`);
  }

  create(data: {
    scopeRegex?: string;
    candidates: DomainCandidate[];
    equations: ProposedEquation[];
    commitSha: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.insertStmt.run(
      id,
      'active',
      data.scopeRegex ?? null,
      JSON.stringify(data.candidates),
      JSON.stringify(data.equations),
      data.commitSha,
      now,
      now,
    );
    return id;
  }

  get(id: string): DomainSessionData | null {
    const row = this.getStmt.get(id) as SessionRow | undefined;
    if (!row) return null;
    return this.rowToSession(row);
  }

  list(): DomainSessionData[] {
    const rows = this.listStmt.all() as SessionRow[];
    return rows.map(r => this.rowToSession(r));
  }

  update(id: string, data: Partial<DomainSessionData>): void {
    const current = this.get(id);
    if (!current) throw new Error(`Domain session not found: ${id}`);

    const merged: DomainSessionData = { ...current, ...data };
    this.updateStmt.run(
      merged.status,
      merged.scopeRegex,
      JSON.stringify(merged.candidates),
      JSON.stringify(merged.equations),
      Date.now(),
      id,
    );
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }

  private rowToSession(row: SessionRow): DomainSessionData {
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
}
