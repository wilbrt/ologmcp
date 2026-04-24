-- olog SQLite schema
-- Requires SQLite >= 3.37.0 for STRICT tables

CREATE TABLE IF NOT EXISTS olog_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS olog_elem (
  id     TEXT PRIMARY KEY,
  kind   TEXT NOT NULL,
  name   TEXT NOT NULL,
  module TEXT,
  span   TEXT,
  attrs  TEXT NOT NULL DEFAULT '{}',
  CHECK (kind IN (
    'file','module','symbol','callsite','import','type',
    'interface','class','enum','function','method','const',
    'var','namespace','other'
  )),
  CHECK (json_valid(attrs))
) STRICT;

CREATE TABLE IF NOT EXISTS olog_arr (
  id     TEXT PRIMARY KEY,
  kind   TEXT NOT NULL,
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  attrs  TEXT NOT NULL DEFAULT '{}',
CHECK (kind IN (
    'extends','implements','calls','imports','exports',
    'references','contains','returns','param','typeof',
    'instanceof','definedIn','inModule','memberOf',
    'callerOf','calleeOf','importsFrom','locatedIn','other'
  )),
  CHECK (json_valid(attrs)),
  FOREIGN KEY (src_id) REFERENCES olog_elem(id) ON DELETE CASCADE,
  FOREIGN KEY (dst_id) REFERENCES olog_elem(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS olog_attr (
  elem_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (elem_id, key),
  FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS olog_prov (
  elem_id      TEXT NOT NULL,
  source       TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  ingested_at  INTEGER NOT NULL,
  PRIMARY KEY (elem_id, source, commit_sha),
  FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE,
  CHECK (source IN ('tree-sitter','lsp','manual','heuristic','other'))
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS olog_violation (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  elem_id TEXT NOT NULL,
  rule    TEXT NOT NULL,
  message TEXT NOT NULL,
  FOREIGN KEY (elem_id) REFERENCES olog_elem(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS olog_equation (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  human_message    TEXT NOT NULL,
  lhs_json         TEXT NOT NULL,
  rhs_json         TEXT NOT NULL,
  provenance_json  TEXT,
  CHECK (json_valid(lhs_json)),
  CHECK (json_valid(rhs_json))
) STRICT;

CREATE TABLE IF NOT EXISTS olog_constraint (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  message          TEXT,
  config_json      TEXT,
  provenance_json  TEXT,
  CHECK (kind IN ('existence','layering','monotonicity','totality'))
) STRICT;

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_elem_kind   ON olog_elem(kind);
CREATE INDEX IF NOT EXISTS idx_elem_name   ON olog_elem(name);
CREATE INDEX IF NOT EXISTS idx_elem_module ON olog_elem(module);
CREATE INDEX IF NOT EXISTS idx_arr_src_id  ON olog_arr(src_id);
CREATE INDEX IF NOT EXISTS idx_arr_dst_id  ON olog_arr(dst_id);
CREATE INDEX IF NOT EXISTS idx_arr_kind    ON olog_arr(kind);
CREATE INDEX IF NOT EXISTS idx_attr_elem_id ON olog_attr(elem_id);
CREATE INDEX IF NOT EXISTS idx_prov_elem_id ON olog_prov(elem_id);
CREATE INDEX IF NOT EXISTS idx_violation_elem_id ON olog_violation(elem_id);
CREATE INDEX IF NOT EXISTS idx_equation_name ON olog_equation(name);
CREATE INDEX IF NOT EXISTS idx_constraint_kind ON olog_constraint(kind);
