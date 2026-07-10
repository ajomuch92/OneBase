import { getDB } from './db.ts'
import type { CollectionSchemaJSON, FieldDefinition, ColumnInfo } from './db.ts'
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Approximates the FieldType a live column type came from — used only as
// informational metadata on modify_column ops, not for anything operational.
function sqlTypeToFieldType(sqlType: string): FieldDefinition['type'] {
  const t = sqlType.toUpperCase()
  if (t.includes('DOUBLE') || t === 'REAL' || t.includes('FLOAT')) return 'number'
  if (t.includes('INT'))                                          return 'boolean'
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
  live: Map<string, ColumnInfo>,
): MigrationOp[] {
  const ops: MigrationOp[] = []
  const SYSTEM = new Set(['id', 'created_at', 'updated_at'])

  for (const [name, field] of Object.entries(desired.fields)) {
    if (SYSTEM.has(name)) continue
    if (!live.has(name)) {
      ops.push({ type: 'add_column', collection: collectionName, column: name, field })
    } else {
      const liveCol   = live.get(name)!
      const db        = getDB()
      const wantedSQL = db.fieldTypeToSQL(field).toUpperCase()
      const liveSQL   = liveCol.sqlType.toUpperCase()
      if (wantedSQL !== liveSQL) {
        ops.push({ type: 'modify_column', collection: collectionName, column: name, field, oldField: { type: sqlTypeToFieldType(liveCol.sqlType) } })
      }
      if (field.unique && !liveCol.unique) ops.push({ type: 'add_unique',  collection: collectionName, column: name })
      if (!field.unique && liveCol.unique) ops.push({ type: 'drop_unique', collection: collectionName, column: name })
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

function describeOp(table: string, op: MigrationOp): string {
  switch (op.type) {
    case 'add_column':    return `ADD COLUMN ${table}.${op.column}`
    case 'drop_column':   return `DROP COLUMN ${table}.${op.column}`
    case 'modify_column': return `MODIFY COLUMN TYPE ${table}.${op.column}`
    case 'add_unique':    return `ADD UNIQUE INDEX ${table}.${op.column}`
    case 'drop_unique':   return `DROP UNIQUE INDEX ${table}.${op.column}`
    default:               return `${op.type} ${table}`
  }
}

export function buildPlan(collectionName: string, ops: MigrationOp[]): MigrationPlan {
  const dangerous  = ops.some(o => o.type === 'drop_column' || o.type === 'modify_column')
  const filledOps  = ops.map(op => ({ ...op, sql: describeOp(collectionName, op) }))
  return { collection: collectionName, ops: filledOps, dangerous }
}

// ─── Plan runner ──────────────────────────────────────────────────────────────

export async function runPlan(plan: MigrationPlan): Promise<void> {
  const db = getDB()

  for (const op of plan.ops) {
    console.log(`[migrations] ${op.sql}`)
    switch (op.type) {
      case 'add_column':    await db.addColumn(plan.collection, op.column!, op.field!);      break
      case 'drop_column':   await db.dropColumn(plan.collection, op.column!);                break
      case 'modify_column': await db.modifyColumnType(plan.collection, op.column!, op.field!); break
      case 'add_unique':    await db.addUniqueIndex(plan.collection, op.column!);             break
      case 'drop_unique':   await db.dropUniqueIndex(plan.collection, op.column!);            break
    }

    const migName  = `${plan.collection}__${op.type}__${op.column ?? 'table'}__${Date.now()}`
    const checksum = await hashString(op.sql ?? op.type)
    await db.insertIgnore('_ob_migrations', ['name', 'checksum'], [migName, checksum])
  }
}

// ─── Full sync with diffing ────────────────────────────────────────────────────

export async function syncCollectionsWithDiff(defs: CollectionDefinition[]): Promise<void> {
  const db = getDB()

  for (const def of defs) {
    const schemaJSON: CollectionSchemaJSON = { fields: def.fields }

    if (!(await db.tableExists(def.name))) {
      console.log(`[migrations] Creating table: ${def.name}`)
      await db.createTable(def.name, def.fields)
      await db.insertIgnore('_ob_collections', ['id', 'name', 'schema'], [crypto.randomUUID(), def.name, JSON.stringify(schemaJSON)])
    } else {
      const liveCols = await db.getColumns(def.name)
      const live     = new Map(liveCols.map(c => [c.name, c]))
      const ops      = diffSchema(def.name, schemaJSON, live)
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

      await db.run(
        `UPDATE _ob_collections SET schema = ?, updated_at = ${db.nowSQL()} WHERE name = ?`,
        [JSON.stringify(schemaJSON), def.name]
      )
    }
  }
}
