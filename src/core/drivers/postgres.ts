import pg from 'pg'
import type { DBAdapter, ColumnInfo, IndexInfo, FieldDefinition } from './types.ts'
import type { DBConfig } from '../config.ts'

// By default node-postgres parses TIMESTAMP/TIMESTAMPTZ columns into JS Date
// objects. The rest of the app expects plain ISO-ish strings (that's what
// SQLite/MySQL hand back), so force these OIDs to pass through as strings.
pg.types.setTypeParser(1114 /* timestamp */,   (v: string) => v)
pg.types.setTypeParser(1184 /* timestamptz */, (v: string) => v)

const TYPE_MAP: Record<FieldDefinition['type'], string> = {
  string: 'TEXT', text: 'TEXT', number: 'DOUBLE PRECISION',
  boolean: 'SMALLINT', date: 'TEXT', datetime: 'TEXT',
  json: 'TEXT', relation: 'TEXT', file: 'TEXT',
}

function toPositional(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

export class PostgresAdapter implements DBAdapter {
  readonly dialect = 'postgres' as const
  private client: pg.Client | null = null

  constructor(private config: DBConfig) {}

  private get c(): pg.Client {
    if (!this.client) throw new Error('PostgresAdapter not connected. Call connect() first.')
    return this.client
  }

  async connect(): Promise<void> {
    this.client = this.config.url
      ? new pg.Client({ connectionString: this.config.url, ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined })
      : new pg.Client({
          host:     this.config.host,
          port:     this.config.port,
          user:     this.config.user,
          password: this.config.password,
          database: this.config.database,
          ssl:      this.config.ssl ? { rejectUnauthorized: false } : undefined,
        })
    await this.client.connect()
  }

  async close(): Promise<void> {
    await this.client?.end()
    this.client = null
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.c.query(toPositional(sql), params)
    return res.rows as T[]
  }

  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const res = await this.c.query(toPositional(sql), params)
    return (res.rows[0] as T) ?? null
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.c.query(toPositional(sql), params)
  }

  async exec(sql: string): Promise<void> {
    await this.c.query(sql)
  }

  quoteIdent(name: string): string {
    return `"${name}"`
  }

  nowSQL(): string {
    return 'NOW()'
  }

  fieldTypeToSQL(field: FieldDefinition): string {
    // A `multiple: true` relation stores a JSON array of ids instead of a
    // single one — needs the long-text column, not the single-id type.
    if (field.type === 'relation' && field.multiple) return TYPE_MAP.text
    return TYPE_MAP[field.type] ?? 'TEXT'
  }

  async tableExists(name: string): Promise<boolean> {
    const row = await this.get(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?`,
      [name],
    )
    return !!row
  }

  async getColumns(name: string): Promise<ColumnInfo[]> {
    const cols = await this.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ?
       ORDER BY ordinal_position`,
      [name],
    )
    const indexes = await this.listIndexes(name)
    const uniqueCols = new Set(
      indexes.filter(i => i.unique && i.columns.length === 1).map(i => i.columns[0]),
    )
    return cols.map(c => ({
      name:         c.column_name,
      sqlType:      c.data_type.toUpperCase(),
      notNull:      c.is_nullable === 'NO',
      unique:       uniqueCols.has(c.column_name),
      defaultValue: c.column_default,
    }))
  }

  async hasUniqueIndex(table: string, column: string): Promise<boolean> {
    const indexes = await this.listIndexes(table)
    return indexes.some(i => i.unique && i.columns.length === 1 && i.columns[0] === column)
  }

  async listIndexes(table: string): Promise<IndexInfo[]> {
    // `unnest(ix.indkey) WITH ORDINALITY` preserves the index's own column
    // order (which for composite indexes differs from the table's column
    // order) — plain `array_agg(... ORDER BY a.attnum)` would get that wrong.
    const rows = await this.query<{ index_name: string; columns: string[]; is_unique: boolean }>(
      `SELECT i.relname as index_name, ix.indisunique as is_unique,
              array_agg(a.attname ORDER BY k.ord) as columns
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i  ON i.oid = ix.indexrelid
       JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE t.relname = ? AND NOT ix.indisprimary
       GROUP BY i.relname, ix.indisunique`,
      [table],
    )
    return rows.map(r => ({ name: r.index_name, columns: r.columns, unique: r.is_unique }))
  }

  async createIndex(table: string, name: string, columns: string[], unique: boolean): Promise<void> {
    await this.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${name} ON ${table}(${columns.join(', ')})`)
  }

  async dropIndex(table: string, name: string): Promise<void> {
    await this.exec(`DROP INDEX IF EXISTS ${name}`)
  }

  async createTable(name: string, fields: Record<string, FieldDefinition>): Promise<void> {
    const cols = Object.entries(fields).map(([col, field]) => this.columnDef(col, field)).join(',\n')
    await this.exec(`CREATE TABLE IF NOT EXISTS ${name} (
      id         TEXT PRIMARY KEY,
      ${cols}${cols ? ',' : ''}
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
  }

  async dropTable(name: string): Promise<void> {
    await this.exec(`DROP TABLE IF EXISTS ${name}`)
  }

  async addColumn(table: string, col: string, field: FieldDefinition): Promise<void> {
    await this.exec(`ALTER TABLE ${table} ADD COLUMN ${this.columnDef(col, field)}`)
  }

  async dropColumn(table: string, col: string): Promise<void> {
    await this.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`)
  }

  async modifyColumnType(table: string, col: string, field: FieldDefinition): Promise<void> {
    const type = this.fieldTypeToSQL(field)
    await this.exec(`ALTER TABLE ${table} ALTER COLUMN ${col} TYPE ${type} USING ${col}::${type}`)
  }

  async addUniqueIndex(table: string, col: string): Promise<void> {
    await this.createIndex(table, `idx_${table}_${col}`, [col], true)
  }

  async dropUniqueIndex(table: string, col: string): Promise<void> {
    await this.dropIndex(table, `idx_${table}_${col}`)
  }

  async insertIgnore(table: string, cols: string[], values: unknown[]): Promise<void> {
    const ph = cols.map(() => '?').join(', ')
    await this.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT DO NOTHING`, values)
  }

  async upsertKV(table: string, keyCol: string, valCol: string, key: string, value: string): Promise<void> {
    await this.run(
      `INSERT INTO ${table} (${keyCol}, ${valCol}) VALUES (?, ?)
       ON CONFLICT (${keyCol}) DO UPDATE SET ${valCol} = EXCLUDED.${valCol}`,
      [key, value],
    )
  }

  private columnDef(col: string, field: FieldDefinition): string {
    const type    = this.fieldTypeToSQL(field)
    const notNull = field.required ? ' NOT NULL' : ''
    const unique  = field.unique   ? ' UNIQUE'   : ''
    const dflt    = field.default !== undefined ? ` DEFAULT ${JSON.stringify(field.default)}` : ''
    return `${col} ${type}${notNull}${unique}${dflt}`
  }

  async bootstrapSystemTables(): Promise<void> {
    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      verified      SMALLINT NOT NULL DEFAULT 0,
      meta          TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES _ob_users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_collections (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      schema     TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
      checksum   TEXT NOT NULL
    )`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_files (
      id          TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      path        TEXT NOT NULL,
      url         TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      size        BIGINT NOT NULL,
      collection  TEXT,
      record_id   TEXT,
      field       TEXT,
      uploaded_by TEXT,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_plugin_store (
      store_key TEXT PRIMARY KEY,
      value     TEXT NOT NULL
    )`)
  }
}
