import { getSQLite, tableExists, fieldTypeToSQL, createCollectionTable } from './db.ts'
import type { CollectionSchemaJSON, FieldDefinition } from './db.ts'
import type { CollectionDefinition } from './collections.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MigrationOpType =
  | 'create_table'
  | 'add_column'
  | 'drop_column'
  | 'modify_column'
  | 'add_unique'
  | 'drop_unique'

export interface MigrationOp {
  type:       MigrationOpType
  collection: string
  column?:    string
  field?:     FieldDefinition
  oldField?:  FieldDefinition
  sql?:       string
}

export interface MigrationPlan {
  collection: string
  ops:        MigrationOp[]
  dangerous:  boolean
}

// ─── Introspect live SQLite table ─────────────────────────────────────────────

interface SQLiteColumn {
  cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number
}

function introspectTable(tableName: string): Map<string, SQLiteColumn> {
  const cols = getSQLite().query(`PRAGMA table_info(${tableName})`).all() as SQLiteColumn[]
  return new Map(cols.map(c => [c.name, c]))
}

function checkUniqueIndex(table: string, column: string): boolean {
  const db      = getSQLite()
  const indexes = db.query(`PRAGMA index_list(${table})`).all() as { name: string; unique: number }[]
  for (const idx of indexes) {
    if (!idx.unique) continue
    const cols = db.query(`PRAGMA index_info(${idx.name})`).all() as { name: string }[]
    if (cols.some(c => c.name === column)) return true
  }
  return false
}

function sqlTypeToFieldType(sqlType: string): FieldDefinition['type'] {
  const t = sqlType.toUpperCase()
  if (t === 'REAL')    return 'number'
  if (t === 'INTEGER') return 'boolean'
  return 'string'
}

async function hashString(input: string): Promise<string> {
  const buf    = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// ─── Diff engine ──────────────────────────────────────────────────────────────

export function diffSchema(
  collectionName: string,
  desired: CollectionSchemaJSON,
  live: Map<string, SQLiteColumn>,
): MigrationOp[] {
  const ops: MigrationOp[] = []
  const SYSTEM = new Set(['id', 'created_at', 'updated_at'])

  for (const [name, field] of Object.entries(desired.fields)) {
    if (SYSTEM.has(name)) continue
    if (!live.has(name)) {
      ops.push({ type: 'add_column', collection: collectionName, column: name, field })
    } else {
      const liveCol   = live.get(name)!
      const wantedSQL = fieldTypeToSQL(field).toUpperCase()
      const liveSQL   = liveCol.type.toUpperCase()
      if (wantedSQL !== liveSQL) {
        ops.push({ type: 'modify_column', collection: collectionName, column: name, field, oldField: { type: sqlTypeToFieldType(liveCol.type) } })
      }
      const hasUnique = checkUniqueIndex(collectionName, name)
      if (field.unique && !hasUnique) ops.push({ type: 'add_unique',  collection: collectionName, column: name })
      if (!field.unique && hasUnique) ops.push({ type: 'drop_unique', collection: collectionName, column: name })
    }
  }

  for (const name of live.keys()) {
    if (!SYSTEM.has(name) && !desired.fields[name]) {
      ops.push({ type: 'drop_column', collection: collectionName, column: name })
    }
  }

  return ops
}

// ─── Plan builder ─────────────────────────────────────────────────────────────

export function buildPlan(collectionName: string, ops: MigrationOp[]): MigrationPlan {
  const dangerous = ops.some(o => o.type === 'drop_column' || o.type === 'modify_column')

  const filledOps: MigrationOp[] = ops.map(op => {
    switch (op.type) {
      case 'add_column': {
        const colType = fieldTypeToSQL(op.field!)
        const notNull = op.field!.required ? ' NOT NULL' : ''
        const unique  = op.field!.unique   ? ' UNIQUE'   : ''
        const dflt    = op.field!.default !== undefined
          ? ` DEFAULT ${JSON.stringify(op.field!.default)}`
          : ' DEFAULT NULL'
        return { ...op, sql: `ALTER TABLE ${collectionName} ADD COLUMN ${op.column} ${colType}${notNull}${unique}${dflt}` }
      }
      case 'drop_column':
        return { ...op, sql: `ALTER TABLE ${collectionName} DROP COLUMN ${op.column}` }
      case 'modify_column':
        return { ...op, sql: `-- RECREATE TABLE for column type change: ${collectionName}.${op.column}` }
      case 'add_unique':
        return { ...op, sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_${collectionName}_${op.column} ON ${collectionName}(${op.column})` }
      case 'drop_unique':
        return { ...op, sql: `DROP INDEX IF EXISTS idx_${collectionName}_${op.column}` }
      default:
        return op
    }
  })

  return { collection: collectionName, ops: filledOps, dangerous }
}

// ─── Plan runner ──────────────────────────────────────────────────────────────

export async function runPlan(plan: MigrationPlan): Promise<void> {
  const db = getSQLite()

  for (const op of plan.ops) {
    if (op.type === 'modify_column') {
      await recreateTableForModify(plan.collection, op)
    } else if (op.sql && !op.sql.startsWith('--')) {
      console.log(`[migrations] ${op.sql}`)
      db.run(op.sql)
    }

    const migName  = `${plan.collection}__${op.type}__${op.column ?? 'table'}__${Date.now()}`
    const checksum = await hashString(op.sql ?? op.type)
    db.run(`INSERT OR IGNORE INTO _ob_migrations (name, checksum) VALUES (?, ?)`, [migName, checksum])
  }
}

async function recreateTableForModify(tableName: string, op: MigrationOp): Promise<void> {
  const db      = getSQLite()
  const tmpName = `${tableName}_migration_tmp_${Date.now()}`
  const schemaRow = db.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(tableName) as { sql: string } | null
  if (!schemaRow) throw new Error(`Table "${tableName}" not found`)

  const newSQL = schemaRow.sql
    .replace(tableName, tmpName)
    .replace(new RegExp(`(${op.column}\\s+)\\w+`, 'i'), `$1${fieldTypeToSQL(op.field!)}`)

  console.log(`[migrations] Recreating table ${tableName} for column type change on "${op.column}"`)
  db.run('BEGIN')
  try {
    db.run(newSQL)
    db.run(`INSERT INTO ${tmpName} SELECT * FROM ${tableName}`)
    db.run(`DROP TABLE ${tableName}`)
    db.run(`ALTER TABLE ${tmpName} RENAME TO ${tableName}`)
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

// ─── Full sync with diffing ────────────────────────────────────────────────────

export async function syncCollectionsWithDiff(defs: CollectionDefinition[]): Promise<void> {
  const db = getSQLite()

  for (const def of defs) {
    const schemaJSON: CollectionSchemaJSON = { fields: def.fields }

    if (!tableExists(def.name)) {
      console.log(`[migrations] Creating table: ${def.name}`)
      createCollectionTable(def.name, schemaJSON)
      db.run(
        'INSERT OR IGNORE INTO _ob_collections (id, name, schema) VALUES (?, ?, ?)',
        [crypto.randomUUID(), def.name, JSON.stringify(schemaJSON)]
      )
    } else {
      const live = introspectTable(def.name)
      const ops  = diffSchema(def.name, schemaJSON, live)
      if (ops.length === 0) continue

      let plan = buildPlan(def.name, ops)

      if (plan.dangerous) {
        console.warn(
          `[migrations] ⚠️  Destructive migrations for "${def.name}":\n` +
          plan.ops.filter(o => o.type === 'drop_column' || o.type === 'modify_column')
            .map(o => `  - ${o.type}: ${o.column}`).join('\n') +
          '\n  Set ONEBASE_ALLOW_DESTRUCTIVE=true to apply.'
        )
        if (!process.env.ONEBASE_ALLOW_DESTRUCTIVE) {
          plan.ops = plan.ops.filter(o => o.type !== 'drop_column' && o.type !== 'modify_column')
        }
      }

      if (plan.ops.length > 0) {
        await runPlan(plan)
        console.log(`[migrations] ✓ Migrated "${def.name}" — ${plan.ops.length} change(s)`)
      }

      db.run(
        'UPDATE _ob_collections SET schema = ?, updated_at = datetime(\'now\') WHERE name = ?',
        [JSON.stringify(schemaJSON), def.name]
      )
    }
  }
}
