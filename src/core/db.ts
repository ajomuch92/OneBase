import { Database } from 'bun:sqlite'

// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldType =
  | 'string' | 'text' | 'number' | 'boolean'
  | 'date' | 'datetime' | 'json' | 'relation' | 'file'

export interface FieldDefinition {
  type:        FieldType
  required?:   boolean
  default?:    unknown
  unique?:     boolean
  collection?: string
  multiple?:   boolean
}

export interface CollectionSchemaJSON {
  fields: Record<string, FieldDefinition>
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _sqlite: Database | null = null

export function getSQLite(): Database {
  if (!_sqlite) throw new Error('DB not initialized. Call initDB() first.')
  return _sqlite
}

export function initDB(path = './onebase.db'): Database {
  _sqlite = new Database(path)
  _sqlite.run('PRAGMA journal_mode = WAL')
  _sqlite.run('PRAGMA synchronous  = NORMAL')
  _sqlite.run('PRAGMA foreign_keys = ON')
  _sqlite.run('PRAGMA cache_size   = -64000')
  _sqlite.run('PRAGMA temp_store   = MEMORY')
  bootstrapSystemTables(_sqlite)
  return _sqlite
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function bootstrapSystemTables(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS _ob_users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    verified      INTEGER NOT NULL DEFAULT 0,
    meta          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS _ob_sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES _ob_users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS _ob_collections (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    schema     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS _ob_migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    checksum   TEXT NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS _ob_files (
    id          TEXT PRIMARY KEY,
    filename    TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    path        TEXT NOT NULL,
    url         TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size        INTEGER NOT NULL,
    collection  TEXT,
    record_id   TEXT,
    field       TEXT,
    uploaded_by TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS _ob_plugin_store (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`)
}

// ─── Dynamic table helpers ────────────────────────────────────────────────────

export function fieldTypeToSQL(field: FieldDefinition): string {
  const map: Record<FieldType, string> = {
    string: 'TEXT', text: 'TEXT', number: 'REAL',
    boolean: 'INTEGER', date: 'TEXT', datetime: 'TEXT',
    json: 'TEXT', relation: 'TEXT', file: 'TEXT',
  }
  return map[field.type] ?? 'TEXT'
}

export function createCollectionTable(name: string, schema: CollectionSchemaJSON) {
  const db = getSQLite()
  const cols = Object.entries(schema.fields).map(([col, field]) => {
    const type     = fieldTypeToSQL(field)
    const notNull  = field.required ? ' NOT NULL' : ''
    const unique   = field.unique   ? ' UNIQUE'   : ''
    const dflt     = field.default !== undefined ? ` DEFAULT ${JSON.stringify(field.default)}` : ''
    return `  ${col} ${type}${notNull}${unique}${dflt}`
  }).join(',\n')

  db.run(`CREATE TABLE IF NOT EXISTS ${name} (
    id         TEXT PRIMARY KEY,
    ${cols},
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
}

export function tableExists(name: string): boolean {
  const db = getSQLite()
  return !!db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name)
}
