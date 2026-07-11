import type { Dialect } from './drivers/types.ts'

export interface DBConfig {
  client: Dialect
  // sqlite
  path?: string
  // mysql / postgres — either `url`, or the discrete fields below
  url?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: boolean
}

const DEFAULT_PORT: Record<'mysql' | 'postgres' | 'mssql', number> = { mysql: 3306, postgres: 5432, mssql: 1433 }

/**
 * Reads ONEBASE_DB_* from the environment (Bun loads .env automatically).
 * `cliPath` is the `--db` flag's value, used as the sqlite path fallback so
 * existing `onebase start --db ./foo.db` invocations keep working.
 */
export function loadDBConfig(cliPath?: string): DBConfig {
  const client = (process.env.ONEBASE_DB_CLIENT ?? 'sqlite').toLowerCase() as Dialect

  if (client === 'sqlite') {
    return { client, path: process.env.ONEBASE_DB_PATH ?? cliPath ?? './onebase.db' }
  }

  if (client !== 'mysql' && client !== 'postgres' && client !== 'mssql') {
    throw new Error(`Unknown ONEBASE_DB_CLIENT "${client}". Expected "sqlite", "mysql", "postgres", or "mssql".`)
  }

  return {
    client,
    url:      process.env.ONEBASE_DB_URL,
    host:     process.env.ONEBASE_DB_HOST ?? 'localhost',
    port:     Number(process.env.ONEBASE_DB_PORT ?? DEFAULT_PORT[client]),
    user:     process.env.ONEBASE_DB_USER ?? 'root',
    password: process.env.ONEBASE_DB_PASSWORD ?? '',
    database: process.env.ONEBASE_DB_NAME ?? 'onebase',
    ssl:      process.env.ONEBASE_DB_SSL === 'true',
  }
}
