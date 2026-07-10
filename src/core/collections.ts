import { getDB } from './db.ts'
import type { CollectionSchemaJSON, FieldDefinition } from './db.ts'
import type { CollectionPermissions } from './permissions.ts'
import { permissionEngine } from './permissions.ts'

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
    return this.db.query<CollectionRecord>(q, params)
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
    return this.db.get<CollectionRecord>(`SELECT * FROM ${this.name} WHERE id = ?`, [id])
  }

  async create(data: Record<string, unknown>, ctx: HookContext): Promise<CollectionRecord> {
    await this.assertExists()
    let payload = this.def?.hooks?.beforeCreate ? await this.def.hooks.beforeCreate({ ...data }, ctx) : { ...data }
    const id    = crypto.randomUUID()
    const now   = new Date().toISOString()
    const row   = { ...payload, id, created_at: now, updated_at: now }
    const cols  = Object.keys(row).join(', ')
    const ph    = Object.keys(row).map(() => '?').join(', ')
    await this.db.run(`INSERT INTO ${this.name} (${cols}) VALUES (${ph})`, Object.values(row))
    const record = (await this.getById(id))!
    if (this.def?.hooks?.afterCreate) await this.def.hooks.afterCreate(record, ctx)
    return record
  }

  async update(id: string, data: Record<string, unknown>, ctx: HookContext): Promise<CollectionRecord> {
    await this.assertExists()
    let payload = this.def?.hooks?.beforeUpdate ? await this.def.hooks.beforeUpdate(id, { ...data }, ctx) : { ...data }
    const row   = { ...payload, updated_at: new Date().toISOString() }
    const set   = Object.keys(row).map(k => `${k} = ?`).join(', ')
    await this.db.run(`UPDATE ${this.name} SET ${set} WHERE id = ?`, [...Object.values(row), id])
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
