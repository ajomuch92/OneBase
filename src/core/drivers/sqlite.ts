import { Database } from 'bun:sqlite'
import type { DBAdapter, ColumnInfo, IndexInfo, FieldDefinition } from './types.ts'

const TYPE_MAP: Record<FieldDefinition['type'], string> = {
  string: 'TEXT', text: 'TEXT', number: 'REAL',
  boolean: 'INTEGER', date: 'TEXT', datetime: 'TEXT',
  json: 'TEXT', relation: 'TEXT', file: 'TEXT',
}

interface SQLiteColumnRow {
  cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number
}

export class SQLiteAdapter implements DBAdapter {
  readonly dialect = 'sqlite' as const
  private db: Database | null = null

  constructor(private path: string) {}

  private get conn(): Database {
    if (!this.db) throw new Error('SQLiteAdapter not connected. Call connect() first.')
    return this.db
  }

  async connect(): Promise<void> {
    this.db = new Database(this.path)
    this.db.run('PRAGMA journal_mode = WAL')
    this.db.run('PRAGMA synchronous  = NORMAL')
    this.db.run('PRAGMA foreign_keys = ON')
    this.db.run('PRAGMA cache_size   = -64000')
    this.db.run('PRAGMA temp_store   = MEMORY')
  }

  async close(): Promise<void> {
    this.db?.close()
    this.db = null
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.conn.query(sql).all(...(params as any[])) as T[]
  }

  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (this.conn.query(sql).get(...(params as any[])) as T) ?? null
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.conn.run(sql, params as any[])
  }

  async exec(sql: string): Promise<void> {
    this.conn.run(sql)
  }

  quoteIdent(name: string): string {
    return `"${name}"`
  }

  nowSQL(): string {
    return "datetime('now')"
  }

  fieldTypeToSQL(field: FieldDefinition): string {
    // A `multiple: true` relation stores a JSON array of ids instead of a
    // single one — needs the long-text column, not the (often shorter)
    // single-id type.
    if (field.type === 'relation' && field.multiple) return TYPE_MAP.text
    return TYPE_MAP[field.type] ?? 'TEXT'
  }

  async tableExists(name: string): Promise<boolean> {
    return !!this.conn.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name)
  }

  async getColumns(name: string): Promise<ColumnInfo[]> {
    const cols = this.conn.query(`PRAGMA table_info(${name})`).all() as SQLiteColumnRow[]
    const indexes = await this.listIndexes(name)
    const uniqueCols = new Set(
      indexes.filter(i => i.unique && i.columns.length === 1).map(i => i.columns[0]),
    )
    return cols.map(c => ({
      name:         c.name,
      sqlType:      c.type.toUpperCase(),
      notNull:      !!c.notnull,
      unique:       uniqueCols.has(c.name),
      defaultValue: c.dflt_value,
    }))
  }

  async hasUniqueIndex(table: string, column: string): Promise<boolean> {
    const indexes = await this.listIndexes(table)
    return indexes.some(i => i.unique && i.columns.length === 1 && i.columns[0] === column)
  }

  async listIndexes(table: string): Promise<IndexInfo[]> {
    const indexes = this.conn.query(`PRAGMA index_list(${table})`).all() as { name: string; unique: number; origin: string }[]
    const result: IndexInfo[] = []
    for (const idx of indexes) {
      if (idx.origin === 'pk') continue
      const cols = this.conn.query(`PRAGMA index_info(${idx.name})`).all() as { name: string; seqno: number }[]
      result.push({
        name:    idx.name,
        columns: cols.sort((a, b) => a.seqno - b.seqno).map(c => c.name),
        unique:  !!idx.unique,
      })
    }
    return result
  }

  async createIndex(table: string, name: string, columns: string[], unique: boolean): Promise<void> {
    this.conn.run(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${name} ON ${table}(${columns.join(', ')})`)
  }

  async dropIndex(table: string, name: string): Promise<void> {
    this.conn.run(`DROP INDEX IF EXISTS ${name}`)
  }

  async createTable(name: string, fields: Record<string, FieldDefinition>): Promise<void> {
    const cols = Object.entries(fields).map(([col, field]) => this.columnDef(col, field)).join(',\n')
    this.conn.run(`CREATE TABLE IF NOT EXISTS ${name} (
      id         TEXT PRIMARY KEY,
      ${cols}${cols ? ',' : ''}
      created_at TEXT NOT NULL DEFAULT (${this.nowSQL()}),
      updated_at TEXT NOT NULL DEFAULT (${this.nowSQL()})
    )`)
  }

  async dropTable(name: string): Promise<void> {
    this.conn.run(`DROP TABLE IF EXISTS ${name}`)
  }

  async addColumn(table: string, col: string, field: FieldDefinition): Promise<void> {
    this.conn.run(`ALTER TABLE ${table} ADD COLUMN ${this.columnDef(col, field)}`)
  }

  async dropColumn(table: string, col: string): Promise<void> {
    this.conn.run(`ALTER TABLE ${table} DROP COLUMN ${col}`)
  }

  // SQLite can't ALTER COLUMN TYPE — recreate the table with the new type,
  // copy rows across, swap names. Wrapped in a transaction for atomicity.
  async modifyColumnType(table: string, col: string, field: FieldDefinition): Promise<void> {
    const tmpName = `${table}_migration_tmp_${Date.now()}`
    const schemaRow = this.conn.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table) as { sql: string } | null
    if (!schemaRow) throw new Error(`Table "${table}" not found`)

    const newSQL = schemaRow.sql
      .replace(table, tmpName)
      .replace(new RegExp(`(${col}\\s+)\\w+`, 'i'), `$1${this.fieldTypeToSQL(field)}`)

    this.conn.run('BEGIN')
    try {
      this.conn.run(newSQL)
      this.conn.run(`INSERT INTO ${tmpName} SELECT * FROM ${table}`)
      this.conn.run(`DROP TABLE ${table}`)
      this.conn.run(`ALTER TABLE ${tmpName} RENAME TO ${table}`)
      this.conn.run('COMMIT')
    } catch (err) {
      this.conn.run('ROLLBACK')
      throw err
    }
  }

  async addUniqueIndex(table: string, col: string): Promise<void> {
    await this.createIndex(table, `idx_${table}_${col}`, [col], true)
  }

  async dropUniqueIndex(table: string, col: string): Promise<void> {
    await this.dropIndex(table, `idx_${table}_${col}`)
  }

  async insertIgnore(table: string, cols: string[], values: unknown[]): Promise<void> {
    const ph = cols.map(() => '?').join(', ')
    this.conn.run(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${ph})`, values as any[])
  }

  async upsertKV(table: string, keyCol: string, valCol: string, key: string, value: string): Promise<void> {
    this.conn.run(`INSERT OR REPLACE INTO ${table} (${keyCol}, ${valCol}) VALUES (?, ?)`, [key, value])
  }

  private columnDef(col: string, field: FieldDefinition): string {
    const type    = this.fieldTypeToSQL(field)
    const notNull = field.required ? ' NOT NULL' : ''
    const unique  = field.unique   ? ' UNIQUE'   : ''
    const dflt    = field.default !== undefined ? ` DEFAULT ${JSON.stringify(field.default)}` : ''
    return `${col} ${type}${notNull}${unique}${dflt}`
  }

  async bootstrapSystemTables(): Promise<void> {
    const db = this.conn
    db.run(`CREATE TABLE IF NOT EXISTS _ob_users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      verified      INTEGER NOT NULL DEFAULT 0,
      meta          TEXT,
      created_at    TEXT NOT NULL DEFAULT (${this.nowSQL()}),
      updated_at    TEXT NOT NULL DEFAULT (${this.nowSQL()})
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS _ob_sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES _ob_users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${this.nowSQL()})
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS _ob_collections (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      schema     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${this.nowSQL()}),
      updated_at TEXT NOT NULL DEFAULT (${this.nowSQL()})
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS _ob_migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (${this.nowSQL()}),
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
      created_at  TEXT NOT NULL DEFAULT (${this.nowSQL()})
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS _ob_plugin_store (
      store_key TEXT PRIMARY KEY,
      value     TEXT NOT NULL
    )`)
  }
}
