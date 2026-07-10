import type { DBAdapter } from './drivers/types.ts'
import type { DBConfig } from './config.ts'
import { createAdapter } from './drivers/index.ts'

export type { FieldType, FieldDefinition, CollectionSchemaJSON, ColumnInfo, IndexInfo, Dialect, DBAdapter } from './drivers/types.ts'

// ─── Singleton ────────────────────────────────────────────────────────────────

let _db: DBAdapter | null = null

export function getDB(): DBAdapter {
  if (!_db) throw new Error('DB not initialized. Call initDB() first.')
  return _db
}

export async function initDB(config: DBConfig): Promise<DBAdapter> {
  const adapter = createAdapter(config)
  await adapter.connect()
  await adapter.bootstrapSystemTables()
  _db = adapter
  return adapter
}
