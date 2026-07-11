import mysql from 'mysql2/promise'
import type { DBAdapter, ColumnInfo, IndexInfo, FieldDefinition } from './types.ts'
import type { DBConfig } from '../config.ts'

const TYPE_MAP: Record<FieldDefinition['type'], string> = {
  string: 'VARCHAR(255)', text: 'TEXT', number: 'DOUBLE',
  boolean: 'TINYINT(1)', date: 'VARCHAR(32)', datetime: 'VARCHAR(32)',
  json: 'LONGTEXT', relation: 'VARCHAR(36)', file: 'VARCHAR(255)',
}

export class MySQLAdapter implements DBAdapter {
  readonly dialect = 'mysql' as const
  private conn: mysql.Connection | null = null

  constructor(private config: DBConfig) {}

  private get c(): mysql.Connection {
    if (!this.conn) throw new Error('MySQLAdapter not connected. Call connect() first.')
    return this.conn
  }

  async connect(): Promise<void> {
    // dateStrings keeps DATETIME/TIMESTAMP columns coming back as plain
    // strings instead of JS Date objects, matching the ISO-string shape
    // the rest of the app expects (see collections.ts, uploads.ts).
    this.conn = this.config.url
      ? await mysql.createConnection({ uri: this.config.url, dateStrings: true })
      : await mysql.createConnection({
          host:     this.config.host,
          port:     this.config.port,
          user:     this.config.user,
          password: this.config.password,
          database: this.config.database,
          ssl:      this.config.ssl ? {} : undefined,
          dateStrings: true,
        })
  }

  async close(): Promise<void> {
    await this.conn?.end()
    this.conn = null
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.c.query(sql, params)
    return rows as T[]
  }

  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const [rows] = await this.c.query(sql, params)
    return ((rows as any[])[0] as T) ?? null
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.c.query(sql, params)
  }

  async exec(sql: string): Promise<void> {
    await this.c.query(sql)
  }

  quoteIdent(name: string): string {
    return `\`${name}\``
  }

  nowSQL(): string {
    return 'CURRENT_TIMESTAMP(3)'
  }

  fieldTypeToSQL(field: FieldDefinition): string {
    // A `multiple: true` relation stores a JSON array of ids instead of a
    // single one — needs the long-text column, not VARCHAR(36).
    if (field.type === 'relation' && field.multiple) return TYPE_MAP.text
    return TYPE_MAP[field.type] ?? 'VARCHAR(255)'
  }

  async tableExists(name: string): Promise<boolean> {
    const row = await this.get(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [name],
    )
    return !!row
  }

  async getColumns(name: string): Promise<ColumnInfo[]> {
    const cols = await this.query<{ COLUMN_NAME: string; COLUMN_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null }>(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [name],
    )
    const indexes = await this.listIndexes(name)
    const uniqueCols = new Set(
      indexes.filter(i => i.unique && i.columns.length === 1).map(i => i.columns[0]),
    )
    return cols.map(c => ({
      name:         c.COLUMN_NAME,
      sqlType:      c.COLUMN_TYPE.toUpperCase(),
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
    const rows = await this.query<{ INDEX_NAME: string; COLUMN_NAME: string; NON_UNIQUE: number; SEQ_IN_INDEX: number }>(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME != 'PRIMARY'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [table],
    )
    const byName = new Map<string, IndexInfo>()
    for (const r of rows) {
      let idx = byName.get(r.INDEX_NAME)
      if (!idx) {
        idx = { name: r.INDEX_NAME, columns: [], unique: r.NON_UNIQUE === 0 }
        byName.set(r.INDEX_NAME, idx)
      }
      idx.columns.push(r.COLUMN_NAME)
    }
    return Array.from(byName.values())
  }

  async createIndex(table: string, name: string, columns: string[], unique: boolean): Promise<void> {
    if ((await this.listIndexes(table)).some(i => i.name === name)) return
    await this.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${table}(${columns.join(', ')})`)
  }

  async dropIndex(table: string, name: string): Promise<void> {
    if (!(await this.listIndexes(table)).some(i => i.name === name)) return
    await this.exec(`ALTER TABLE ${table} DROP INDEX ${name}`)
  }

  async createTable(name: string, fields: Record<string, FieldDefinition>): Promise<void> {
    const cols = Object.entries(fields).map(([col, field]) => this.columnDef(col, field)).join(',\n')
    await this.exec(`CREATE TABLE IF NOT EXISTS ${name} (
      id         VARCHAR(36) PRIMARY KEY,
      ${cols}${cols ? ',' : ''}
      created_at VARCHAR(32) NOT NULL,
      updated_at VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB`)
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
    await this.exec(`ALTER TABLE ${table} MODIFY COLUMN ${col} ${this.fieldTypeToSQL(field)}`)
  }

  async addUniqueIndex(table: string, col: string): Promise<void> {
    await this.createIndex(table, `idx_${table}_${col}`, [col], true)
  }

  async dropUniqueIndex(table: string, col: string): Promise<void> {
    await this.dropIndex(table, `idx_${table}_${col}`)
  }

  async insertIgnore(table: string, cols: string[], values: unknown[]): Promise<void> {
    const ph = cols.map(() => '?').join(', ')
    await this.run(`INSERT IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${ph})`, values)
  }

  async upsertKV(table: string, keyCol: string, valCol: string, key: string, value: string): Promise<void> {
    await this.run(
      `INSERT INTO ${table} (${this.quoteIdent(keyCol)}, ${this.quoteIdent(valCol)}) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE ${this.quoteIdent(valCol)} = VALUES(${this.quoteIdent(valCol)})`,
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
      id            VARCHAR(36) PRIMARY KEY,
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role          VARCHAR(32) NOT NULL DEFAULT 'user',
      verified      TINYINT(1) NOT NULL DEFAULT 0,
      meta          TEXT,
      created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_sessions (
      id         VARCHAR(36) PRIMARY KEY,
      user_id    VARCHAR(36) NOT NULL,
      token      VARCHAR(1024) NOT NULL UNIQUE,
      expires_at VARCHAR(48) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      FOREIGN KEY (user_id) REFERENCES _ob_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_collections (
      id         VARCHAR(36) PRIMARY KEY,
      name       VARCHAR(255) NOT NULL UNIQUE,
      schema     LONGTEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_migrations (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(512) NOT NULL UNIQUE,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      checksum   VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_files (
      id          VARCHAR(36) PRIMARY KEY,
      filename    VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL UNIQUE,
      path        VARCHAR(1024) NOT NULL,
      url         VARCHAR(1024) NOT NULL,
      mime_type   VARCHAR(255) NOT NULL,
      size        BIGINT NOT NULL,
      collection  VARCHAR(255),
      record_id   VARCHAR(36),
      field       VARCHAR(255),
      uploaded_by VARCHAR(36),
      created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`)

    await this.exec(`CREATE TABLE IF NOT EXISTS _ob_plugin_store (
      store_key VARCHAR(255) PRIMARY KEY,
      value     LONGTEXT NOT NULL
    ) ENGINE=InnoDB`)
  }
}
