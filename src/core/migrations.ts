import { getSQLite, getDB, collectionsTable, createCollectionTable, fieldTypeToSQL } from './db.ts'
import type { CollectionSchemaJSON, FieldDefinition } from './db.ts'
import { eq } from 'drizzle-orm'
import type { CollectionDefinition } from './collections.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MigrationOpType =
  | 'create_table'
  | 'add_column'
  | 'drop_column'
  | 'modify_column'   // rename or type change → recreate via copy
  | 'add_unique'
  | 'drop_unique'

export interface MigrationOp {
  type:        MigrationOpType
  collection:  string
  column?:     string
  field?:      FieldDefinition
  oldField?:   FieldDefinition
  sql?:        string            // final SQL string, filled in by planner
}

export interface MigrationPlan {
  collection: string
  ops:        MigrationOp[]
  dangerous:  boolean            // true if any op is potentially destructive
}

// ─── Introspect live table columns from SQLite ─────────────────────────────────

interface SQLiteColumn {
  cid:        number
  name:       string
  type:       string
  notnull:    number
  dflt_value: string | null
  pk:         number
}

export function introspectTable(tableName: string): Map<string, SQLiteColumn> {
  const sqlite  = getSQLite()
  const columns = sqlite.query(`PRAGMA table_info(${tableName})`).all() as SQLiteColumn[]
  const map     = new Map<string, SQLiteColumn>()
  for (const col of columns) map.set(col.name, col)
  return map
}

export function tableExists(tableName: string): boolean {
  const sqlite = getSQLite()
  const result = sqlite
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { name: string } | null
  return result !== null
}

// ─── Diff engine ──────────────────────────────────────────────────────────────

/**
 * Compare the desired schema (from TypeScript) with the live SQLite table
 * and produce a list of MigrationOps needed to reconcile them.
 */
export function diffSchema(
  collectionName: string,
  desired:        CollectionSchemaJSON,
  live:           Map<string, SQLiteColumn>,
): MigrationOp[] {
  const ops: MigrationOp[] = []

  // System columns that always exist — never touch them
  const SYSTEM_COLS = new Set(['id', 'created_at', 'updated_at'])

  // ── 1. Find new columns (in desired, not in live) ─────────────────────────

  for (const [name, field] of Object.entries(desired.fields)) {
    if (SYSTEM_COLS.has(name)) continue

    if (!live.has(name)) {
      ops.push({
        type:       'add_column',
        collection: collectionName,
        column:     name,
        field,
      })
    } else {
      // ── 2. Check for type changes ─────────────────────────────────────────
      const liveCol   = live.get(name)!
      const wantedSQL = fieldTypeToSQL(field).toUpperCase()
      const liveSQL   = liveCol.type.toUpperCase()

      if (wantedSQL !== liveSQL) {
        ops.push({
          type:       'modify_column',
          collection: collectionName,
          column:     name,
          field,
          oldField:   { type: sqlTypeToFieldType(liveCol.type) },
        })
      }

      // ── 3. Check unique constraint changes ────────────────────────────────
      const hasUniqueIndex = checkUniqueIndex(collectionName, name)

      if (field.unique && !hasUniqueIndex) {
        ops.push({ type: 'add_unique',  collection: collectionName, column: name })
      }
      if (!field.unique && hasUniqueIndex) {
        ops.push({ type: 'drop_unique', collection: collectionName, column: name })
      }
    }
  }

  // ── 4. Find dropped columns (in live, not in desired) ────────────────────

  for (const name of live.keys()) {
    if (SYSTEM_COLS.has(name)) continue
    if (!desired.fields[name]) {
      ops.push({
        type:       'drop_column',
        collection: collectionName,
        column:     name,
      })
    }
  }

  return ops
}

// ─── Plan builder — fills in SQL for each op ─────────────────────────────────

export function buildPlan(collectionName: string, ops: MigrationOp[]): MigrationPlan {
  const dangerous = ops.some(o =>
    o.type === 'drop_column' || o.type === 'modify_column'
  )

  const filledOps: MigrationOp[] = ops.map(op => {
    switch (op.type) {

      case 'add_column': {
        const colType   = fieldTypeToSQL(op.field!)
        const notNull   = op.field!.required ? ' NOT NULL' : ''
        const unique    = op.field!.unique   ? ' UNIQUE'   : ''
        const dflt      = op.field!.default !== undefined
          ? ` DEFAULT ${JSON.stringify(op.field!.default)}`
          : op.field!.required ? '' : ' DEFAULT NULL'

        return {
          ...op,
          sql: `ALTER TABLE ${collectionName} ADD COLUMN ${op.column} ${colType}${notNull}${unique}${dflt}`,
        }
      }

      case 'drop_column':
        // SQLite ≥ 3.35 supports DROP COLUMN
        return {
          ...op,
          sql: `ALTER TABLE ${collectionName} DROP COLUMN ${op.column}`,
        }

      case 'modify_column':
        // SQLite does NOT support ALTER COLUMN — must recreate table
        return {
          ...op,
          sql: `-- RECREATE TABLE for column type change: ${collectionName}.${op.column}`,
        }

      case 'add_unique':
        return {
          ...op,
          sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_${collectionName}_${op.column} ON ${collectionName}(${op.column})`,
        }

      case 'drop_unique':
        return {
          ...op,
          sql: `DROP INDEX IF EXISTS idx_${collectionName}_${op.column}`,
        }

      default:
        return op
    }
  })

  return { collection: collectionName, ops: filledOps, dangerous }
}

// ─── Migration runner ─────────────────────────────────────────────────────────

export async function runPlan(plan: MigrationPlan): Promise<void> {
  const sqlite = getSQLite()
  const db     = getDB()

  for (const op of plan.ops) {
    if (op.type === 'modify_column') {
      // Full table recreation for type changes
      await recreateTableForModify(plan.collection, op)
    } else if (op.sql) {
      console.log(`[migrations] ${op.sql}`)
      sqlite.run(op.sql)
    }

    // Record migration in _just_migrations
    const migName = `${plan.collection}__${op.type}__${op.column ?? 'table'}__${Date.now()}`
    const checksum = await hashString(op.sql ?? op.type)

    await db.insert(collectionsTable._.table ?? collectionsTable).values({}).catch(() => {})
    // Use raw sqlite for migrations log since it's a simple insert
    sqlite.run(
      `INSERT OR IGNORE INTO _just_migrations (name, checksum) VALUES (?, ?)`,
      [migName, checksum],
    )
  }
}

/**
 * Recreates a table to apply a column type change.
 * Strategy: CREATE new_temp → INSERT SELECT → DROP old → RENAME new_temp → old
 */
async function recreateTableForModify(
  tableName: string,
  op:        MigrationOp,
): Promise<void> {
  const sqlite  = getSQLite()
  const tmpName = `${tableName}_migration_tmp_${Date.now()}`

  // Get current full schema from SQLite
  const schemaRow = sqlite
    .query(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { sql: string } | null

  if (!schemaRow) throw new Error(`Table "${tableName}" not found`)

  // Swap the column type in the original CREATE statement
  const newSQL = schemaRow.sql
    .replace(tableName, tmpName)
    .replace(
      new RegExp(`(${op.column}\\s+)\\w+`, 'i'),
      `$1${fieldTypeToSQL(op.field!)}`,
    )

  console.log(`[migrations] Recreating table ${tableName} for column type change on "${op.column}"`)

  sqlite.run('BEGIN')
  try {
    sqlite.run(newSQL)
    sqlite.run(`INSERT INTO ${tmpName} SELECT * FROM ${tableName}`)
    sqlite.run(`DROP TABLE ${tableName}`)
    sqlite.run(`ALTER TABLE ${tmpName} RENAME TO ${tableName}`)
    sqlite.run('COMMIT')
  } catch (err) {
    sqlite.run('ROLLBACK')
    throw err
  }
}

// ─── Full sync with diffing ────────────────────────────────────────────────────

export async function syncCollectionsWithDiff(defs: CollectionDefinition[]): Promise<void> {
  const db = getDB()

  for (const def of defs) {
    const schemaJSON: CollectionSchemaJSON = { fields: def.fields }

    if (!tableExists(def.name)) {
      // Brand new collection — just create it
      console.log(`[migrations] Creating table: ${def.name}`)
      createCollectionTable(def.name, schemaJSON)

      await db.insert(collectionsTable).values({
        id:     crypto.randomUUID(),
        name:   def.name,
        schema: schemaJSON,
      }).onConflictDoUpdate({
        target: collectionsTable.name,
        set:    { schema: schemaJSON },
      })
    } else {
      // Table exists — diff and apply changes
      const live = introspectTable(def.name)
      const ops  = diffSchema(def.name, schemaJSON, live)

      if (ops.length === 0) {
        // No changes
        continue
      }

      const plan = buildPlan(def.name, ops)

      if (plan.dangerous) {
        console.warn(
          `[migrations] ⚠️  Destructive migrations detected for "${def.name}":\n` +
          plan.ops.filter(o => o.type === 'drop_column' || o.type === 'modify_column')
            .map(o => `  - ${o.type}: ${o.column}`)
            .join('\n') +
          '\n  Set JUST_TS_ALLOW_DESTRUCTIVE=true to apply.'
        )

        if (!process.env.JUST_TS_ALLOW_DESTRUCTIVE) {
          // Skip destructive ops, only apply safe ones
          plan.ops = plan.ops.filter(o =>
            o.type !== 'drop_column' && o.type !== 'modify_column'
          )
        }
      }

      if (plan.ops.length > 0) {
        await runPlan(plan)
        console.log(`[migrations] ✓ Migrated "${def.name}" — ${plan.ops.length} change(s)`)
      }

      // Update stored schema
      await db
        .update(collectionsTable)
        .set({ schema: schemaJSON })
        .where(eq(collectionsTable.name, def.name))
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function checkUniqueIndex(table: string, column: string): boolean {
  const sqlite = getSQLite()
  const indexes = sqlite
    .query(`PRAGMA index_list(${table})`)
    .all() as { name: string; unique: number }[]

  for (const idx of indexes) {
    if (!idx.unique) continue
    const cols = sqlite
      .query(`PRAGMA index_info(${idx.name})`)
      .all() as { name: string }[]
    if (cols.some(c => c.name === column)) return true
  }
  return false
}

function sqlTypeToFieldType(sqlType: string): FieldDefinition['type'] {
  const t = sqlType.toUpperCase()
  if (t === 'TEXT')    return 'string'
  if (t === 'REAL')    return 'number'
  if (t === 'INTEGER') return 'boolean'
  return 'string'
}

async function hashString(input: string): Promise<string> {
  const buf    = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
