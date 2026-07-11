// ─── Field / schema types ───────────────────────────────────────────────────
// Shared by db.ts (re-exported from there for existing call sites) and by
// every adapter, which needs FieldDefinition to translate a field into its
// own dialect's column type.

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

// ─── Adapter-facing types ───────────────────────────────────────────────────

export type Dialect = 'sqlite' | 'mysql' | 'postgres' | 'mssql'

export interface ColumnInfo {
  name:         string
  sqlType:      string   // uppercased base type as created by this dialect's fieldTypeToSQL
  notNull:      boolean
  unique:       boolean
  defaultValue: string | null
}

export interface IndexInfo {
  name:    string
  columns: string[]   // in index-key order — matters for composite indexes
  unique:  boolean
}

export interface DBAdapter {
  readonly dialect: Dialect

  connect(): Promise<void>
  close(): Promise<void>

  /** Generic escape hatch. Callers always write `?` placeholders — the
   *  adapter translates to its native placeholder style internally. */
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>
  get<T = any>(sql: string, params?: unknown[]): Promise<T | null>
  run(sql: string, params?: unknown[]): Promise<void>
  /** DDL statement, no params. */
  exec(sql: string): Promise<void>

  /** Wraps an identifier (table/column name) in this dialect's quote char. */
  quoteIdent(name: string): string

  /** SQL fragment for "current timestamp", used inline in queries. */
  nowSQL(): string

  // ── Schema / DDL ──────────────────────────────────────────────────────
  fieldTypeToSQL(field: FieldDefinition): string
  tableExists(name: string): Promise<boolean>
  getColumns(name: string): Promise<ColumnInfo[]>
  hasUniqueIndex(table: string, column: string): Promise<boolean>
  createTable(name: string, fields: Record<string, FieldDefinition>): Promise<void>
  dropTable(name: string): Promise<void>
  addColumn(table: string, col: string, field: FieldDefinition): Promise<void>
  dropColumn(table: string, col: string): Promise<void>
  modifyColumnType(table: string, col: string, field: FieldDefinition): Promise<void>
  addUniqueIndex(table: string, col: string): Promise<void>
  dropUniqueIndex(table: string, col: string): Promise<void>

  // ── General-purpose index management (arbitrary name/columns/uniqueness,
  //    used by the admin UI's Indexes panel) ──────────────────────────────
  listIndexes(table: string): Promise<IndexInfo[]>
  createIndex(table: string, name: string, columns: string[], unique: boolean): Promise<void>
  dropIndex(table: string, name: string): Promise<void>

  // ── Upserts used by system tables ───────────────────────────────────────
  insertIgnore(table: string, cols: string[], values: unknown[]): Promise<void>
  upsertKV(table: string, keyCol: string, valCol: string, key: string, value: string): Promise<void>

  /** Creates the 6 `_ob_*` system tables if they don't already exist. */
  bootstrapSystemTables(): Promise<void>
}
