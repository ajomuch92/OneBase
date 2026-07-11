import type { DBAdapter } from './types.ts'
import type { DBConfig } from '../config.ts'

export type { DBAdapter, ColumnInfo, Dialect, FieldType, FieldDefinition, CollectionSchemaJSON } from './types.ts'

// Adapters are imported lazily, one at a time, so that picking "sqlite"
// never pulls in the mysql2/pg/mssql modules. `bun build --compile` is
// unreliable at embedding npm packages reached only through a dynamically
// imported module in a graph this size (see the long comment in
// src/core/cron.ts for the full investigation) — eagerly/statically
// importing all four adapters made the compiled binary crash on startup
// even for the sqlite-only case. Lazy-loading only the selected adapter
// sidesteps the bug for the common case (sqlite, the default) at the cost
// of mysql/postgres/mssql not being usable from the compiled exe today —
// run via `bun run` for those until this Bun limitation is fixed upstream.
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
