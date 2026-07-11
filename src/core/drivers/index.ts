import type { DBAdapter } from './types.ts'
import type { DBConfig } from '../config.ts'

export type { DBAdapter, ColumnInfo, Dialect, FieldType, FieldDefinition, CollectionSchemaJSON } from './types.ts'

// Adapters are imported lazily, one at a time, so that picking "sqlite"
// never pulls in the mysql2/pg/mssql modules. That matters most for `bun
// build --compile`: those packages' internal dynamic requires don't get
// bundled into the standalone binary, so eagerly importing all of them at
// startup crashes the compiled exe immediately even when only SQLite is used.
export async function createAdapter(config: DBConfig): Promise<DBAdapter> {
  switch (config.client) {
    case 'sqlite': {
      const { SQLiteAdapter } = await import('./sqlite.ts')
      return new SQLiteAdapter(config.path ?? './onebase.db')
    }
    case 'mysql': {
      const { MySQLAdapter } = await import('./mysql.ts')
      return new MySQLAdapter(config)
    }
    case 'postgres': {
      const { PostgresAdapter } = await import('./postgres.ts')
      return new PostgresAdapter(config)
    }
    case 'mssql': {
      const { MSSQLAdapter } = await import('./mssql.ts')
      return new MSSQLAdapter(config)
    }
    default:
      throw new Error(`Unknown DB client "${(config as DBConfig).client}"`)
  }
}
