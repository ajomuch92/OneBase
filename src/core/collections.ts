import { getSQLite, getDB, collectionsTable, createCollectionTable, dropCollectionTable } from './db.ts'
import type { CollectionSchemaJSON, FieldDefinition } from './db.ts'
import { eq } from 'drizzle-orm'
import { pluginRunner } from '../plugins/loader.ts'
import { syncCollectionsWithDiff } from './migrations.ts'
import type { CollectionPermissions } from './permissions.ts'
import { permissionEngine } from './permissions.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CollectionRecord {
  id: string
  [key: string]: unknown
  created_at: string
  updated_at: string
}

export interface QueryOptions {
  filter?: Record<string, unknown>
  sort?:   string
  order?:  'asc' | 'desc'
  limit?:  number
  offset?: number
  expand?: string[]   // relation fields to expand
}

export interface CollectionDefinition {
  name:        string
  fields:      Record<string, FieldDefinition>
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

export interface HookContext {
  userId?: string
  role?:   string
  collection: string
}

// ─── In-memory registry of collection definitions ────────────────────────────

const registry = new Map<string, CollectionDefinition>()

export function defineCollection(def: CollectionDefinition): CollectionDefinition {
  registry.set(def.name, def)
  if (def.permissions) {
    permissionEngine.register(def.name, def.permissions)
  }
  return def
}

export function getCollectionDef(name: string): CollectionDefinition | undefined {
  return registry.get(name)
}

export function getAllCollectionDefs(): CollectionDefinition[] {
  return Array.from(registry.values())
}

// ─── Sync registry → DB (called on startup) ──────────────────────────────────

export async function syncCollections() {
  await syncCollectionsWithDiff(Array.from(registry.values()))
}

// ─── CRUD engine ─────────────────────────────────────────────────────────────

export class CollectionService {
  constructor(private readonly collectionName: string) {}

  private get sqlite() { return getSQLite() }

  private get def(): CollectionDefinition {
    const d = registry.get(this.collectionName)
    if (!d) throw new Error(`Collection "${this.collectionName}" not found`)
    return d
  }

  // ── List ──────────────────────────────────────────────────────────────────

  list(opts: QueryOptions = {}): CollectionRecord[] {
    const { filter, sort = 'created_at', order = 'desc', limit = 50, offset = 0 } = opts

    let query = `SELECT * FROM ${this.collectionName}`
    const params: unknown[] = []

    if (filter && Object.keys(filter).length > 0) {
      const conditions = Object.entries(filter).map(([k, v]) => {
        params.push(v)
        return `${k} = ?`
      })
      query += ` WHERE ${conditions.join(' AND ')}`
    }

    query += ` ORDER BY ${sort} ${order.toUpperCase()}`
    query += ` LIMIT ? OFFSET ?`
    params.push(limit, offset)

    return this.sqlite.query(query).all(...params) as CollectionRecord[]
  }

  // ── Count ─────────────────────────────────────────────────────────────────

  count(filter?: Record<string, unknown>): number {
    let query = `SELECT COUNT(*) as count FROM ${this.collectionName}`
    const params: unknown[] = []

    if (filter && Object.keys(filter).length > 0) {
      const conditions = Object.entries(filter).map(([k, v]) => {
        params.push(v)
        return `${k} = ?`
      })
      query += ` WHERE ${conditions.join(' AND ')}`
    }

    const result = this.sqlite.query(query).get(...params) as { count: number }
    return result.count
  }

  // ── Get one ───────────────────────────────────────────────────────────────

  getById(id: string): CollectionRecord | null {
    return this.sqlite
      .query(`SELECT * FROM ${this.collectionName} WHERE id = ?`)
      .get(id) as CollectionRecord | null
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(
    data: Record<string, unknown>,
    ctx: HookContext,
  ): Promise<CollectionRecord> {
    let payload = { ...data }

    // Run beforeCreate hooks
    if (this.def.hooks?.beforeCreate) {
      payload = await this.def.hooks.beforeCreate(payload, ctx)
    }
    await pluginRunner.runHook('beforeCreate', this.collectionName, payload, ctx)

    this.validateFields(payload)

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const allData = { ...payload, id, created_at: now, updated_at: now }

    const cols   = Object.keys(allData).join(', ')
    const placeholders = Object.keys(allData).map(() => '?').join(', ')
    const values = Object.values(allData)

    this.sqlite
      .query(`INSERT INTO ${this.collectionName} (${cols}) VALUES (${placeholders})`)
      .run(...values)

    const record = this.getById(id)!

    // Run afterCreate hooks
    if (this.def.hooks?.afterCreate) {
      await this.def.hooks.afterCreate(record, ctx)
    }
    await pluginRunner.runHook('afterCreate', this.collectionName, record, ctx)

    return record
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(
    id: string,
    data: Record<string, unknown>,
    ctx: HookContext,
  ): Promise<CollectionRecord> {
    let payload = { ...data }

    if (this.def.hooks?.beforeUpdate) {
      payload = await this.def.hooks.beforeUpdate(id, payload, ctx)
    }
    await pluginRunner.runHook('beforeUpdate', this.collectionName, { id, ...payload }, ctx)

    const existing = this.getById(id)
    if (!existing) throw new Error(`Record "${id}" not found in "${this.collectionName}"`)

    const now = new Date().toISOString()
    const updateData = { ...payload, updated_at: now }

    const setClauses = Object.keys(updateData).map(k => `${k} = ?`).join(', ')
    const values     = [...Object.values(updateData), id]

    this.sqlite
      .query(`UPDATE ${this.collectionName} SET ${setClauses} WHERE id = ?`)
      .run(...values)

    const record = this.getById(id)!

    if (this.def.hooks?.afterUpdate) {
      await this.def.hooks.afterUpdate(record, ctx)
    }
    await pluginRunner.runHook('afterUpdate', this.collectionName, record, ctx)

    return record
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async delete(id: string, ctx: HookContext): Promise<void> {
    if (this.def.hooks?.beforeDelete) {
      await this.def.hooks.beforeDelete(id, ctx)
    }
    await pluginRunner.runHook('beforeDelete', this.collectionName, { id }, ctx)

    const existing = this.getById(id)
    if (!existing) throw new Error(`Record "${id}" not found in "${this.collectionName}"`)

    this.sqlite
      .query(`DELETE FROM ${this.collectionName} WHERE id = ?`)
      .run(id)

    if (this.def.hooks?.afterDelete) {
      await this.def.hooks.afterDelete(id, ctx)
    }
    await pluginRunner.runHook('afterDelete', this.collectionName, { id }, ctx)
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private validateFields(data: Record<string, unknown>) {
    for (const [fieldName, fieldDef] of Object.entries(this.def.fields)) {
      if (fieldDef.required && data[fieldName] === undefined) {
        throw new Error(`Field "${fieldName}" is required in collection "${this.collectionName}"`)
      }
    }
  }
}

// ─── Factory helper ───────────────────────────────────────────────────────────

export function getCollection(name: string): CollectionService {
  return new CollectionService(name)
}
