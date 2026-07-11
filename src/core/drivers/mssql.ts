import sql from 'mssql'
import type { DBAdapter, ColumnInfo, IndexInfo, FieldDefinition } from './types.ts'
import type { DBConfig } from '../config.ts'

// date/datetime stay plain strings (not native DATETIME2) for the same
// reason every other adapter avoids the driver's native temporal type —
// the rest of the app expects ISO-ish strings back, not driver-specific
// Date objects (see the pg type-parser override and mysql2 dateStrings).
const TYPE_MAP: Record<FieldDefinition['type'], string> = {
  string: 'NVARCHAR(255)', text: 'NVARCHAR(MAX)', number: 'FLOAT',
  boolean: 'BIT', date: 'NVARCHAR(32)', datetime: 'NVARCHAR(32)',
  json: 'NVARCHAR(MAX)', relation: 'NVARCHAR(36)', file: 'NVARCHAR(255)',
}

// SQL Server unique-constraint/duplicate-key violations.
const DUPLICATE_KEY_ERRORS = new Set([2627, 2601])

function toNamed(sqlText: string): string {
  let i = 0
  return sqlText.replace(/\?/g, () => `@p${++i}`)
}

export class MSSQLAdapter implements DBAdapter {
  readonly dialect = 'mssql' as const
  private pool: sql.ConnectionPool | null = null

  constructor(private config: DBConfig) {}

  private get p(): sql.ConnectionPool {
    if (!this.pool) throw new Error('MSSQLAdapter not connected. Call connect() first.')
    return this.pool
  }

  async connect(): Promise<void> {
    this.pool = this.config.url
      ? new sql.ConnectionPool(this.config.url)
      : new sql.ConnectionPool({
          server:   this.config.host ?? 'localhost',
          port:     this.config.port,
          user:     this.config.user,
          password: this.config.password,
          database: this.config.database,
          options: {
            encrypt:                !!this.config.ssl,
            trustServerCertificate: !this.config.ssl,
          },
        })
    await this.pool.connect()
  }

  async close(): Promise<void> {
    await this.pool?.close()
    this.pool = null
  }

  private async exec_<T = any>(sqlText: string, params: unknown[] = []): Promise<T[]> {
    const request = this.p.request()
    params.forEach((v, i) => request.input(`p${i + 1}`, v))
    const result = await request.query(toNamed(sqlText))
    return result.recordset as T[]
  }

  async query<T = any>(sqlText: string, params: unknown[] = []): Promise<T[]> {
    return this.exec_<T>(sqlText, params)
  }

  async get<T = any>(sqlText: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.exec_<T>(sqlText, params)
    return rows[0] ?? null
  }

  async run(sqlText: string, params: unknown[] = []): Promise<void> {
    await this.exec_(sqlText, params)
  }

  async exec(sqlText: string): Promise<void> {
    // `.batch()` (not `.query()`) — DDL and multi-statement T-SQL blocks
    // (the IF EXISTS / DECLARE guards used below) parse more reliably as a
    // batch than as a parameterized query.
    await this.p.request().batch(sqlText)
  }

  quoteIdent(name: string): string {
    return `[${name}]`
  }

  nowSQL(): string {
    // Style 127 = ISO8601 with milliseconds — keeps this column a plain
    // string like every other adapter's "now", instead of a native
    // DATETIME2 value the mssql driver would hand back as a JS Date.
    return "CONVERT(NVARCHAR(32), SYSUTCDATETIME(), 127)"
  }

  fieldTypeToSQL(field: FieldDefinition): string {
    return TYPE_MAP[field.type] ?? 'NVARCHAR(255)'
  }

  async tableExists(name: string): Promise<boolean> {
    const row = await this.get(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = SCHEMA_NAME() AND TABLE_NAME = ?`,
      [name],
    )
    return !!row
  }

  async getColumns(name: string): Promise<ColumnInfo[]> {
    const cols = await this.query<{ COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null }>(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = SCHEMA_NAME() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [name],
    )
    const indexes = await this.listIndexes(name)
    const uniqueCols = new Set(
      indexes.filter(i => i.unique && i.columns.length === 1).map(i => i.columns[0]),
    )
    return cols.map(c => ({
      name:         c.COLUMN_NAME,
      sqlType:      c.DATA_TYPE.toUpperCase(),
      notNull:      c.IS_NULLABLE === 'NO',
      unique:       uniqueCols.has(c.COLUMN_NAME),
      defaultValue: c.COLUMN_DEFAULT,
    }))
  }

  async hasUniqueIndex(table: string, column: string): Promise<boolean> {
    const indexes = await this.listIndexes(table)
    return indexes.some(i => i.unique && i.columns.length === 1 && i.columns[0] === column)
  }

  async listIndexes(table: string): Promise<IndexInfo[]> {
    const rows = await this.query<{ index_name: string; column_name: string; is_unique: boolean; key_ordinal: number }>(
      `SELECT i.name AS index_name, c.name AS column_name, i.is_unique AS is_unique, ic.key_ordinal AS key_ordinal
       FROM sys.indexes i
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       JOIN sys.tables t ON t.object_id = i.object_id
       WHERE t.name = ? AND i.is_primary_key = 0 AND i.name IS NOT NULL
       ORDER BY i.name, ic.key_ordinal`,
      [table],
    )
    const byName = new Map<string, IndexInfo>()
    for (const r of rows) {
      let idx = byName.get(r.index_name)
      if (!idx) {
        idx = { name: r.index_name, columns: [], unique: !!r.is_unique }
        byName.set(r.index_name, idx)
      }
      idx.columns.push(r.column_name)
    }
    return Array.from(byName.values())
  }

  async createIndex(table: string, name: string, columns: string[], unique: boolean): Promise<void> {
    if ((await this.listIndexes(table)).some(i => i.name === name)) return
    await this.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${table}(${columns.join(', ')})`)
  }

  async dropIndex(table: string, name: string): Promise<void> {
    if (!(await this.listIndexes(table)).some(i => i.name === name)) return
    await this.exec(`DROP INDEX ${name} ON ${table}`)
  }

  async createTable(name: string, fields: Record<string, FieldDefinition>): Promise<void> {
    const cols = Object.entries(fields).map(([col, field]) => this.columnDef(col, field)).join(',\n')
    await this.exec(`IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '${name}')
    CREATE TABLE ${name} (
      id         NVARCHAR(36) PRIMARY KEY,
      ${cols}${cols ? ',' : ''}
      created_at NVARCHAR(32) NOT NULL,
      updated_at NVARCHAR(32) NOT NULL
    )`)
  }

  async dropTable(name: string): Promise<void> {
    await this.exec(`IF EXISTS (SELECT * FROM sys.tables WHERE name = '${name}') DROP TABLE ${name}`)
  }

  async addColumn(table: string, col: string, field: FieldDefinition): Promise<void> {
    // No "COLUMN" keyword on ADD in T-SQL (unlike MySQL/Postgres/SQLite).
    await this.exec(`ALTER TABLE ${table} ADD ${this.columnDef(col, field)}`)
  }

  async dropColumn(table: string, col: string): Promise<void> {
    // SQL Server won't drop a column that still has a DEFAULT constraint on
    // it, and that constraint's name is auto-generated — look it up and
    // drop it first instead of requiring callers to know/track it.
    await this.exec(`
      DECLARE @cname NVARCHAR(256)
      SELECT @cname = dc.name FROM sys.default_constraints dc
        JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
        WHERE dc.parent_object_id = OBJECT_ID('${table}') AND c.name = '${col}'
      IF @cname IS NOT NULL EXEC('ALTER TABLE ${table} DROP CONSTRAINT ' + @cname)
      EXEC('ALTER TABLE ${table} DROP COLUMN ${col}')
    `)
  }

  async modifyColumnType(table: string, col: string, field: FieldDefinition): Promise<void> {
    await this.exec(`ALTER TABLE ${table} ALTER COLUMN ${col} ${this.fieldTypeToSQL(field)}`)
  }

  async addUniqueIndex(table: string, col: string): Promise<void> {
    await this.createIndex(table, `idx_${table}_${col}`, [col], true)
  }

  async dropUniqueIndex(table: string, col: string): Promise<void> {
    await this.dropIndex(table, `idx_${table}_${col}`)
  }

  async insertIgnore(table: string, cols: string[], values: unknown[]): Promise<void> {
    // No generic "insert, ignore on any conflict" clause in T-SQL (MERGE
    // needs to know the key column up front) — just swallow the specific
    // duplicate-key error instead.
    const ph = cols.map(() => '?').join(', ')
    try {
      await this.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph})`, values)
    } catch (err: any) {
      if (!DUPLICATE_KEY_ERRORS.has(err?.number)) throw err
    }
  }

  async upsertKV(table: string, keyCol: string, valCol: string, key: string, value: string): Promise<void> {
    await this.run(
      `MERGE INTO ${table} WITH (HOLDLOCK) AS target
       USING (SELECT ? AS k, ? AS v) AS src
       ON target.${keyCol} = src.k
       WHEN MATCHED THEN UPDATE SET ${valCol} = src.v
       WHEN NOT MATCHED THEN INSERT (${keyCol}, ${valCol}) VALUES (src.k, src.v);`,
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
    await this.exec(`IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '_ob_users')
    CREATE TABLE _ob_users (
      id            NVARCHAR(36) PRIMARY KEY,
      email         NVARCHAR(255) NOT NULL UNIQUE,
      password_hash NVARCHAR(255) NOT NULL,
      role          NVARCHAR(32) NOT NULL DEFAULT 'user',
      verified      BIT NOT NULL DEFAULT 0,
      meta          NVARCHAR(MAX),
      created_at    NVARCHAR(32) NOT NULL DEFAULT (${this.nowSQL()}),
      updated_at    NVARCHAR(32) NOT NULL DEFAULT (${this.nowSQL()})
    )`)

    // token is capped at 450 (not 1024 like the other adapters) because a
    // nonclustered index key in SQL Server can't exceed 900 bytes, and
    // NVARCHAR counts 2 bytes/char — 450 chars is the max that still fits
    // under a UNIQUE constraint.
    await this.exec(`IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '_ob_sessions')
    CREATE TABLE _ob_sessions (
      id         NVARCHAR(36) PRIMARY KEY,
      user_id    NVARCHAR(36) NOT NULL REFERENCES _ob_users(id) ON DELETE CASCADE,
      token      NVARCHAR(450) NOT NULL UNIQUE,
      expires_at NVARCHAR(32) NOT NULL,
      created_at NVARCHAR(32) NOT NULL DEFAULT (${this.nowSQL()})
    )`)

    await this.exec(`IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '_ob_collections')
    CREATE TABLE _ob_collections (
      id         NVARCHAR(36) PRIMARY KEY,
      name       NVARCHAR(255) NOT NULL UNIQUE,
      schema     NVARCHAR(MAX) NOT NULL,
      created_at NVARCHAR(32) NOT NULL DEFAULT (${this.nowSQL()}),
      updated_at NVARCHAR(32) NOT NULL DEFAULT (${this.nowSQL()})
    )`)

    // Same 900-byte index-key limit applies to migrations.name as to
    // sessions.token above, hence 450 instead of the 512 other adapters use.
    await this.exec(`IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '_ob_migrations')
    CREATE TABLE _ob_migrations (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      name       NVARCHAR(450) NOT NULL UNIQUE,
      applied_at NVARCHAR(32) NOT NULL DEFAULT (${this.nowSQL()}),
      checksum   NVARCHAR(64) NOT NULL
    )`)

    await this.exec(`IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '_ob_files')
    CREATE TABLE _ob_files (
      id          NVARCHAR(36) PRIMARY KEY,
      filename    NVARCHAR(255) NOT NULL,
      stored_name NVARCHAR(255) NOT NULL UNIQUE,
      path        NVARCHAR(1024) NOT NULL,
      url         NVARCHAR(1024) NOT NULL,
      mime_type   NVARCHAR(255) NOT NULL,
      size        BIGINT NOT NULL,
      collection  NVARCHAR(255),
      record_id   NVARCHAR(36),
      field       NVARCHAR(255),
      uploaded_by NVARCHAR(36),
      created_at  NVARCHAR(32) NOT NULL DEFAULT (${this.nowSQL()})
    )`)

    await this.exec(`IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '_ob_plugin_store')
    CREATE TABLE _ob_plugin_store (
      store_key NVARCHAR(255) PRIMARY KEY,
      value     NVARCHAR(MAX) NOT NULL
    )`)
  }
}
