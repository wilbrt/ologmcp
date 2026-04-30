import type Database from 'better-sqlite3';

/**
 * Abstract base class for session CRUD stores.
 * Handles the common get/list/delete pattern and statement preparation,
 * while subclasses define their own create/update/rowToSession logic.
 */
export abstract class SessionStore<RowType, SessionData> {
  protected readonly insertStmt: Database.Statement;
  protected readonly getStmt: Database.Statement;
  protected readonly listStmt: Database.Statement;
  protected readonly updateStmt: Database.Statement;
  protected readonly deleteStmt: Database.Statement;

  constructor(
    protected readonly db: Database.Database,
    insertSQL: string,
    selectColumns: string,
    tableName: string,
    updateSQL: string,
  ) {
    this.insertStmt = db.prepare(insertSQL);
    this.getStmt = db.prepare(`SELECT ${selectColumns} FROM ${tableName} WHERE id = ?`);
    this.listStmt = db.prepare(`SELECT ${selectColumns} FROM ${tableName} ORDER BY created_at DESC`);
    this.updateStmt = db.prepare(updateSQL);
    this.deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
  }

  protected abstract rowToSession(row: RowType): SessionData;

  get(id: string): SessionData | null {
    const row = this.getStmt.get(id) as RowType | undefined;
    if (!row) return null;
    return this.rowToSession(row);
  }

  list(): SessionData[] {
    const rows = this.listStmt.all() as RowType[];
    return rows.map(r => this.rowToSession(r));
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }
}
