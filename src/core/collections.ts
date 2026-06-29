import { getSQLite, createCollectionTable, tableExists, fieldTypeToSQL } from './db.ts'
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

// ─── Sync schema → SQLite on startup ────────────────────────────────────────

export async function syncCollections() {
  const db = getSQLite()
  for (const def of registry.values()) {
    const schema: CollectionSchemaJSON = { fields: def.fields }
    if (!tableExists(def.name)) {
      createCollectionTable(def.name, schema)
      db.run('INSERT OR IGNORE INTO _ob_collections (id, name, schema) VALUES (?, ?, ?)',
        [crypto.randomUUID(), def.name, JSON.stringify(schema)])
    } else {
      await applyDiff(def.name, schema)
      db.run('UPDATE _ob_collections SET schema = ?, updated_at = datetime(\'now\') WHERE name = ?',
        [JSON.stringify(schema), def.name])
    }
  }
}

// ─── Runtime collection management (from admin UI) ───────────────────────────

export function createCollection(name: string, schema: CollectionSchemaJSON) {
  const db = getSQLite()
  if (tableExists(name)) throw new Error(`Collection "${name}" already exists`)
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Name must be lowercase letters, numbers, underscores')
  createCollectionTable(name, schema)
  db.run('INSERT INTO _ob_collections (id, name, schema) VALUES (?, ?, ?)',
    [crypto.randomUUID(), name, JSON.stringify(schema)])
}

export function updateCollection(name: string, newSchema: CollectionSchemaJSON) {
  const db = getSQLite()
  applyDiff(name, newSchema)
  db.run('UPDATE _ob_collections SET schema = ?, updated_at = datetime(\'now\') WHERE name = ?',
    [JSON.stringify(newSchema), name])
}

export function deleteCollection(name: string) {
  const db = getSQLite()
  if (name.startsWith('_ob_')) throw new Error('Cannot delete system collections')
  db.run(`DROP TABLE IF EXISTS ${name}`)
  db.run('DELETE FROM _ob_collections WHERE name = ?', [name])
}

export function listStoredCollections(): Array<{ id: string; name: string; schema: CollectionSchemaJSON; created_at: string }> {
  const db   = getSQLite()
  const rows = db.query('SELECT * FROM _ob_collections ORDER BY created_at ASC').all() as any[]
  return rows.map(r => ({ ...r, schema: JSON.parse(r.schema) }))
}

// ─── Schema diffing ───────────────────────────────────────────────────────────

function applyDiff(tableName: string, desired: CollectionSchemaJSON) {
  const db      = getSQLite()
  const live     = new Map((db.query(`PRAGMA table_info(${tableName})`).all() as any[]).map(c => [c.name, c]))
  const SYSTEM   = new Set(['id', 'created_at', 'updated_at'])

  for (const [col, field] of Object.entries(desired.fields)) {
    if (SYSTEM.has(col)) continue
    if (!live.has(col)) {
      const type  = fieldTypeToSQL(field)
      const nn    = field.required ? ' NOT NULL' : ''
      const uniq  = field.unique   ? ' UNIQUE'   : ''
      const dflt  = field.default !== undefined ? ` DEFAULT ${JSON.stringify(field.default)}` : ' DEFAULT NULL'
      db.run(`ALTER TABLE ${tableName} ADD COLUMN ${col} ${type}${nn}${uniq}${dflt}`)
    }
  }

  if (process.env.ONEBASE_ALLOW_DESTRUCTIVE) {
    for (const col of live.keys()) {
      if (!SYSTEM.has(col) && !desired.fields[col]) {
        db.run(`ALTER TABLE ${tableName} DROP COLUMN ${col}`)
      }
    }
  }
}

// ─── CRUD engine ─────────────────────────────────────────────────────────────

export class CollectionService {
  constructor(private name: string) {}
  private get db() { return getSQLite() }

  // Registry entry is optional — on-the-fly collections (created via admin UI)
  // only exist in the DB, not in the in-memory registry. Hooks only run for
  // code-defined collections that have them.
  private get def(): CollectionDefinition | undefined {
    return registry.get(this.name)
  }

  // Verify the table actually exists in SQLite before any operation
  private assertExists() {
    if (!tableExists(this.name)) {
      throw new Error(`Collection "${this.name}" not found`)
    }
  }

  list(opts: QueryOptions = {}): CollectionRecord[] {
    this.assertExists()
    const { filter = {}, sort = 'created_at', order = 'desc', limit = 50, offset = 0 } = opts
    const params: any[] = []
    let q = `SELECT * FROM ${this.name}`
    const where = Object.entries(filter).map(([k, v]) => { params.push(v); return `${k} = ?` })
    if (where.length) q += ` WHERE ${where.join(' AND ')}`
    q += ` ORDER BY ${sort} ${order.toUpperCase()} LIMIT ? OFFSET ?`
    params.push(limit, offset)
    return this.db.query(q).all(...params) as CollectionRecord[]
  }

  count(filter: Record<string, unknown> = {}): number {
    this.assertExists()
    const params: any[] = []
    let q = `SELECT COUNT(*) as c FROM ${this.name}`
    const where = Object.entries(filter).map(([k, v]) => { params.push(v); return `${k} = ?` })
    if (where.length) q += ` WHERE ${where.join(' AND ')}`
    return (this.db.query(q).get(...params) as any).c
  }

  getById(id: string): CollectionRecord | null {
    this.assertExists()
    return this.db.query(`SELECT * FROM ${this.name} WHERE id = ?`).get(id) as CollectionRecord | null
  }

  async create(data: Record<string, unknown>, ctx: HookContext): Promise<CollectionRecord> {
    this.assertExists()
    let payload = this.def?.hooks?.beforeCreate ? await this.def.hooks.beforeCreate({ ...data }, ctx) : { ...data }
    const id    = crypto.randomUUID()
    const now   = new Date().toISOString()
    const row   = { ...payload, id, created_at: now, updated_at: now }
    const cols  = Object.keys(row).join(', ')
    const ph    = Object.keys(row).map(() => '?').join(', ')
    this.db.query(`INSERT INTO ${this.name} (${cols}) VALUES (${ph})`).run(...Object.values(row))
    const record = this.getById(id)!
    if (this.def?.hooks?.afterCreate) await this.def.hooks.afterCreate(record, ctx)
    return record
  }

  async update(id: string, data: Record<string, unknown>, ctx: HookContext): Promise<CollectionRecord> {
    this.assertExists()
    let payload = this.def?.hooks?.beforeUpdate ? await this.def.hooks.beforeUpdate(id, { ...data }, ctx) : { ...data }
    const row   = { ...payload, updated_at: new Date().toISOString() }
    const set   = Object.keys(row).map(k => `${k} = ?`).join(', ')
    this.db.query(`UPDATE ${this.name} SET ${set} WHERE id = ?`).run(...Object.values(row), id)
    const record = this.getById(id)!
    if (this.def?.hooks?.afterUpdate) await this.def.hooks.afterUpdate(record, ctx)
    return record
  }

  async delete(id: string, ctx: HookContext): Promise<void> {
    this.assertExists()
    if (this.def?.hooks?.beforeDelete) await this.def.hooks.beforeDelete(id, ctx)
    this.db.query(`DELETE FROM ${this.name} WHERE id = ?`).run(id)
    if (this.def?.hooks?.afterDelete) await this.def.hooks.afterDelete(id, ctx)
  }
}

export function getCollection(name: string) { return new CollectionService(name) }