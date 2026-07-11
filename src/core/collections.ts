import { getDB } from './db.ts'
import type { CollectionSchemaJSON, FieldDefinition } from './db.ts'
import type { CollectionPermissions } from './permissions.ts'
import { permissionEngine } from './permissions.ts'
import type { AuthUser } from './auth.ts'

export interface CollectionRecord {
  id: string; [key: string]: unknown; created_at: string; updated_at: string
}

export interface QueryOptions {
  filter?: Record<string, unknown>; sort?: string
  order?: 'asc' | 'desc'; limit?: number; offset?: number
}

export interface HookContext {
  userId?: string; role?: string; collection: string
}

export interface CollectionDefinition {
  name:         string
  fields:       Record<string, FieldDefinition>
  permissions?: CollectionPermissions
  hooks?: {
    beforeCreate?: (data: Record<string, unknown>, ctx: HookContext) => Promise<Record<string, unknown>>
    afterCreate?:  (record: CollectionRecord, ctx: HookContext) => Promise<void>
    beforeUpdate?: (id: string, data: Record<string, unknown>, ctx: HookContext) => Promise<Record<string, unknown>>
    afterUpdate?:  (record: CollectionRecord, ctx: HookContext) => Promise<void>
    beforeDelete?: (id: string, ctx: HookContext) => Promise<void>
    afterDelete?:  (id: string, ctx: HookContext) => Promise<void>
  }
}

const registry = new Map<string, CollectionDefinition>()

export function defineCollection(def: CollectionDefinition): CollectionDefinition {
  registry.set(def.name, def)
  if (def.permissions) permissionEngine.register(def.name, def.permissions)
  return def
}

export function getCollectionDef(name: string) { return registry.get(name) }
export function getAllCollectionDefs()          { return Array.from(registry.values()) }

// ─── Sync schema → DB on startup ────────────────────────────────────────────

export async function syncCollections() {
  const db = getDB()
  for (const def of registry.values()) {
    const schema: CollectionSchemaJSON = { fields: def.fields }
    if (!(await db.tableExists(def.name))) {
      await db.createTable(def.name, def.fields)
      await db.insertIgnore('_ob_collections', ['id', 'name', 'schema'], [crypto.randomUUID(), def.name, JSON.stringify(schema)])
    } else {
      await applyDiff(def.name, schema)
      await db.run(`UPDATE _ob_collections SET schema = ?, updated_at = ${db.nowSQL()} WHERE name = ?`,
        [JSON.stringify(schema), def.name])
    }
  }
}

// ─── Runtime collection management (from admin UI) ───────────────────────────

export async function createCollection(name: string, schema: CollectionSchemaJSON) {
  const db = getDB()
  if (await db.tableExists(name)) throw new Error(`Collection "${name}" already exists`)
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Name must be lowercase letters, numbers, underscores')
  await db.createTable(name, schema.fields)
  await db.run('INSERT INTO _ob_collections (id, name, schema) VALUES (?, ?, ?)',
    [crypto.randomUUID(), name, JSON.stringify(schema)])
}

export async function updateCollection(name: string, newSchema: CollectionSchemaJSON) {
  const db = getDB()
  await applyDiff(name, newSchema)
  await db.run(`UPDATE _ob_collections SET schema = ?, updated_at = ${db.nowSQL()} WHERE name = ?`,
    [JSON.stringify(newSchema), name])
}

export async function deleteCollection(name: string) {
  const db = getDB()
  if (name.startsWith('_ob_')) throw new Error('Cannot delete system collections')
  await db.dropTable(name)
  await db.run('DELETE FROM _ob_collections WHERE name = ?', [name])
}

export async function listStoredCollections(): Promise<Array<{ id: string; name: string; schema: CollectionSchemaJSON; created_at: string }>> {
  const db   = getDB()
  const rows = await db.query<any>('SELECT * FROM _ob_collections ORDER BY created_at ASC')
  return rows.map(r => ({ ...r, schema: JSON.parse(r.schema) }))
}

// ─── Schema diffing ───────────────────────────────────────────────────────────

async function applyDiff(tableName: string, desired: CollectionSchemaJSON) {
  const db     = getDB()
  const live   = new Map((await db.getColumns(tableName)).map(c => [c.name, c]))
  const SYSTEM = new Set(['id', 'created_at', 'updated_at'])

  for (const [col, field] of Object.entries(desired.fields)) {
    if (SYSTEM.has(col)) continue
    if (!live.has(col)) {
      await db.addColumn(tableName, col, field)
    }
  }

  if (process.env.ONEBASE_ALLOW_DESTRUCTIVE) {
    for (const col of live.keys()) {
      if (!SYSTEM.has(col) && !desired.fields[col]) {
        await db.dropColumn(tableName, col)
      }
    }
  }
}

// ─── Multi-relations ────────────────────────────────────────────────────────
// A `relation` field with `multiple: true` stores a JSON-encoded array of
// ids in a single (long-text) column — same approach PocketBase uses, no
// separate join table. `posts.tags` (→ the `tags` collection) is the
// worked example in schema/posts.ts.

// Registry entries only cover code-defined collections — admin-UI-created
// ones only ever exist in `_ob_collections`, so fall back to that stored
// schema to find a collection's field definitions either way.
async function getFieldsForCollection(name: string): Promise<Record<string, FieldDefinition>> {
  const def = registry.get(name)
  if (def) return def.fields
  const row = await getDB().get<{ schema: string }>('SELECT schema FROM _ob_collections WHERE name = ?', [name])
  return row ? (JSON.parse(row.schema) as CollectionSchemaJSON).fields : {}
}

function isMultiRelation(field: FieldDefinition | undefined): boolean {
  return !!field && field.type === 'relation' && !!field.multiple
}

// Arrays going *into* the DB get JSON-encoded — only touches fields that
// are actually present in `row` (partial updates shouldn't touch the rest).
function serializeRow(fields: Record<string, FieldDefinition>, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = (isMultiRelation(fields[k]) && Array.isArray(v)) ? JSON.stringify(v) : v
  }
  return out
}

// ...and decoded back to arrays coming *out*.
function deserializeRecord(fields: Record<string, FieldDefinition>, record: CollectionRecord): CollectionRecord {
  for (const [k, field] of Object.entries(fields)) {
    if (isMultiRelation(field) && typeof record[k] === 'string') {
      try { record[k] = JSON.parse(record[k] as string) } catch { record[k] = [] }
    }
  }
  return record
}

// ─── CRUD engine ─────────────────────────────────────────────────────────────

export class CollectionService {
  constructor(private name: string) {}
  private get db() { return getDB() }

  // Registry entry is optional — on-the-fly collections (created via admin UI)
  // only exist in the DB, not in the in-memory registry. Hooks only run for
  // code-defined collections that have them.
  private get def(): CollectionDefinition | undefined {
    return registry.get(this.name)
  }

  // Verify the table actually exists before any operation
  private async assertExists() {
    if (!(await this.db.tableExists(this.name))) {
      throw new Error(`Collection "${this.name}" not found`)
    }
  }

  async list(opts: QueryOptions = {}): Promise<CollectionRecord[]> {
    await this.assertExists()
    const { filter = {}, sort = 'created_at', order = 'desc', limit = 50, offset = 0 } = opts
    const params: unknown[] = []
    let q = `SELECT * FROM ${this.name}`
    const where = Object.entries(filter).map(([k, v]) => { params.push(v); return `${k} = ?` })
    if (where.length) q += ` WHERE ${where.join(' AND ')}`
    q += ` ORDER BY ${sort} ${order.toUpperCase()} LIMIT ? OFFSET ?`
    params.push(limit, offset)
    const rows   = await this.db.query<CollectionRecord>(q, params)
    const fields = await getFieldsForCollection(this.name)
    return rows.map(r => deserializeRecord(fields, r))
  }

  async count(filter: Record<string, unknown> = {}): Promise<number> {
    await this.assertExists()
    const params: unknown[] = []
    let q = `SELECT COUNT(*) as c FROM ${this.name}`
    const where = Object.entries(filter).map(([k, v]) => { params.push(v); return `${k} = ?` })
    if (where.length) q += ` WHERE ${where.join(' AND ')}`
    const row = await this.db.get<{ c: number }>(q, params)
    return row?.c ?? 0
  }

  async getById(id: string): Promise<CollectionRecord | null> {
    await this.assertExists()
    const record = await this.db.get<CollectionRecord>(`SELECT * FROM ${this.name} WHERE id = ?`, [id])
    if (!record) return null
    return deserializeRecord(await getFieldsForCollection(this.name), record)
  }

  async create(data: Record<string, unknown>, ctx: HookContext): Promise<CollectionRecord> {
    await this.assertExists()
    let payload = this.def?.hooks?.beforeCreate ? await this.def.hooks.beforeCreate({ ...data }, ctx) : { ...data }
    const id     = crypto.randomUUID()
    const now    = new Date().toISOString()
    const row    = { ...payload, id, created_at: now, updated_at: now }
    const fields = await getFieldsForCollection(this.name)
    const dbRow  = serializeRow(fields, row)
    const cols   = Object.keys(dbRow).join(', ')
    const ph     = Object.keys(dbRow).map(() => '?').join(', ')
    await this.db.run(`INSERT INTO ${this.name} (${cols}) VALUES (${ph})`, Object.values(dbRow))
    const record = (await this.getById(id))!
    if (this.def?.hooks?.afterCreate) await this.def.hooks.afterCreate(record, ctx)
    return record
  }

  async update(id: string, data: Record<string, unknown>, ctx: HookContext): Promise<CollectionRecord> {
    await this.assertExists()
    let payload = this.def?.hooks?.beforeUpdate ? await this.def.hooks.beforeUpdate(id, { ...data }, ctx) : { ...data }
    const row    = { ...payload, updated_at: new Date().toISOString() }
    const fields = await getFieldsForCollection(this.name)
    const dbRow  = serializeRow(fields, row)
    const set    = Object.keys(dbRow).map(k => `${k} = ?`).join(', ')
    await this.db.run(`UPDATE ${this.name} SET ${set} WHERE id = ?`, [...Object.values(dbRow), id])
    const record = (await this.getById(id))!
    if (this.def?.hooks?.afterUpdate) await this.def.hooks.afterUpdate(record, ctx)
    return record
  }

  async delete(id: string, ctx: HookContext): Promise<void> {
    await this.assertExists()
    if (this.def?.hooks?.beforeDelete) await this.def.hooks.beforeDelete(id, ctx)
    await this.db.run(`DELETE FROM ${this.name} WHERE id = ?`, [id])
    if (this.def?.hooks?.afterDelete) await this.def.hooks.afterDelete(id, ctx)
  }
}

export function getCollection(name: string) { return new CollectionService(name) }

// ─── Relation expand ──────────────────────────────────────────────────────────

/**
 * PocketBase-style `expand` — resolves `relation` fields into their full
 * related records, attached under `record.expand[fieldName]`. `expandParam`
 * is a comma-separated list of field names; dot-notation expands further
 * levels on the related collection (`expand=author,comments.author`).
 *
 * Related records the caller isn't allowed to `read` are silently left
 * unexpanded rather than failing the whole request — expand should never
 * be a way to see data a direct fetch of that record would deny.
 */
export async function expandRecords(
  collection: string,
  records: CollectionRecord[],
  expandParam: string,
  user: AuthUser | null,
): Promise<CollectionRecord[]> {
  const paths = expandParam.split(',').map(p => p.trim()).filter(Boolean)
  if (!paths.length || !records.length) return records

  // Group by first path segment so "comments.author" and "comments.tags"
  // share a single fetch of `comments` instead of two.
  const byRoot = new Map<string, string[]>()
  for (const path of paths) {
    const [root, ...rest] = path.split('.')
    if (!root) continue
    const nested = byRoot.get(root) ?? []
    if (rest.length) nested.push(rest.join('.'))
    byRoot.set(root, nested)
  }

  const fields = await getFieldsForCollection(collection)
  const db     = getDB()

  for (const [fieldName, nestedPaths] of byRoot) {
    const field = fields[fieldName]
    if (!field || field.type !== 'relation' || !field.collection) continue
    // `users` is the `_ob_users` system table, not a real dynamic
    // collection — special-cased the same way the `/api/users` route is.
    const isUsers = field.collection === 'users'
    // A relation field can name a target collection that was renamed/
    // deleted since the field was defined — skip rather than 500 the
    // whole request over one stale reference.
    if (!isUsers && !(await db.tableExists(field.collection))) continue

    // A `multiple: true` relation's value is an array of ids (already
    // decoded by CollectionService) rather than a single one.
    const ids = [...new Set(
      records.flatMap(r => {
        const v = r[fieldName]
        if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x !== '')
        return typeof v === 'string' && v !== '' ? [v] : []
      }),
    )]
    if (!ids.length) continue

    const placeholders = ids.map(() => '?').join(', ')
    let related = await db.query<CollectionRecord>(
      isUsers
        ? `SELECT id, email, role, verified, created_at FROM _ob_users WHERE id IN (${placeholders})`
        : `SELECT * FROM ${field.collection} WHERE id IN (${placeholders})`,
      ids,
    )

    const readable: CollectionRecord[] = []
    for (const rel of related) {
      try {
        await permissionEngine.assert(field.collection, 'read', user, rel, undefined, isUsers ? 'public' : 'auth')
        readable.push(rel)
      } catch { /* not readable — leave unexpanded */ }
    }
    related = readable

    if (nestedPaths.length) {
      related = await expandRecords(field.collection, related, nestedPaths.join(','), user)
    }

    const byId = new Map(related.map(r => [r.id, r]))
    for (const record of records) {
      const relVal = record[fieldName]
      let expanded: CollectionRecord | CollectionRecord[] | undefined
      if (Array.isArray(relVal)) {
        const resolved = relVal
          .filter((x): x is string => typeof x === 'string')
          .map(relId => byId.get(relId))
          .filter((r): r is CollectionRecord => !!r)
        if (resolved.length) expanded = resolved
      } else if (typeof relVal === 'string') {
        expanded = byId.get(relVal)
      }
      if (!expanded) continue
      const expand = (record.expand as Record<string, unknown> | undefined) ?? {}
      expand[fieldName] = expanded
      record.expand = expand
    }
  }

  return records
}
