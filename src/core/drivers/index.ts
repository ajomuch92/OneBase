import type { DBAdapter } from './types.ts'
import type { DBConfig } from '../config.ts'
import { SQLiteAdapter } from './sqlite.ts'
import { MySQLAdapter } from './mysql.ts'
import { PostgresAdapter } from './postgres.ts'

export type { DBAdapter, ColumnInfo, Dialect, FieldType, FieldDefinition, CollectionSchemaJSON } from './types.ts'

export function createAdapter(config: DBConfig): DBAdapter {
  switch (config.client) {
    case 'sqlite':   return new SQLiteAdapter(config.path ?? './onebase.db')
    case 'mysql':    return new MySQLAdapter(config)
    case 'postgres': return new PostgresAdapter(config)
    default:         throw new Error(`Unknown DB client "${(config as DBConfig).client}"`)
  }
}
