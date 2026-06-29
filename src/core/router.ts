import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { extractAuth, requireAuth } from './auth.ts'
import { getAllCollectionDefs, getCollection, listStoredCollections } from './collections.ts'
import { realtimeService } from './realtime.ts'
import { permissionEngine } from './permissions.ts'
import { uploadService } from './uploads.ts'
import type { HookContext } from './collections.ts'
import { authRouter } from '../api/rest.ts'
import { adminRouter } from '../api/admin/index.ts'

export function createApp() {
  const app = new Hono()

  app.use('*', logger())
  app.use('*', secureHeaders())
  app.use('*', cors({ origin: process.env.ONEBASE_CORS_ORIGIN ?? '*', credentials: true }))

  app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }))

  app.route('/api/auth', authRouter)
  app.route('/admin', adminRouter)

  app.get('/files/*', async (c) => {
    const path = c.req.path.replace('/files/', '')
    return uploadService.serveFile(path)
  })

  const api = new Hono()
  registerCollectionRoutes(api)
  app.route('/api', api)

  app.get('/realtime', async (c) => {
    const auth = await extractAuth(c.req.raw)
    return realtimeService.handleUpgrade(c.req.raw, auth)
  })

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((err, c) => {
    const status = err.message === 'Unauthorized' ? 401 : err.message === 'Forbidden' ? 403
      : err.message.includes('not found') ? 404 : 400
    return c.json({ error: err.message }, status)
  })

  return app
}

function registerCollectionRoutes(api: Hono) {
  // Use stored collections (includes both code-defined and admin-created)
  const getCollections = () => {
    try { return listStoredCollections() } catch { return [] }
  }

  // Dynamic dispatch — resolve collection name at request time
  api.get('/:collection', async (c) => {
    const name = c.req.param('collection')
    const auth = await extractAuth(c.req.raw)
    await permissionEngine.assert(name, 'list', auth?.user ?? null)

    const qs     = c.req.query()
    const limit  = Math.min(Number(qs.limit ?? 50), 500)
    const offset = Number(qs.offset ?? 0)
    const sort   = qs.sort  ?? 'created_at'
    const order  = (qs.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
    const filter: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(qs)) {
      if (!['limit', 'offset', 'sort', 'order'].includes(k)) filter[k] = v
    }

    const svc     = getCollection(name)
    const records = svc.list({ filter, sort, order, limit, offset })
    const total   = svc.count(filter)
    return c.json({ items: records, total, limit, offset })
  })

  api.get('/:collection/:id', async (c) => {
    const { collection, id } = c.req.param()
    const auth   = await extractAuth(c.req.raw)
    const record = getCollection(collection).getById(id)
    if (!record) return c.json({ error: 'Not found' }, 404)
    await permissionEngine.assert(collection, 'read', auth?.user ?? null, record)
    return c.json(record)
  })

  api.post('/:collection', async (c) => {
    const name = c.req.param('collection')
    const auth = await extractAuth(c.req.raw)
    const body = await c.req.json<Record<string, unknown>>()
    await permissionEngine.assert(name, 'create', auth?.user ?? null, undefined, body)
    const ctx: HookContext = { userId: auth?.user.id, role: auth?.user.role, collection: name }
    const record = await getCollection(name).create(body, ctx)
    realtimeService.broadcast(name, 'create', record)
    return c.json(record, 201)
  })

  api.patch('/:collection/:id', async (c) => {
    const { collection, id } = c.req.param()
    const auth     = await extractAuth(c.req.raw)
    const existing = getCollection(collection).getById(id)
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const body = await c.req.json<Record<string, unknown>>()
    await permissionEngine.assert(collection, 'update', auth?.user ?? null, existing, body)
    const ctx: HookContext = { userId: auth?.user.id, role: auth?.user.role, collection }
    const record = await getCollection(collection).update(id, body, ctx)
    realtimeService.broadcast(collection, 'update', record)
    return c.json(record)
  })

  api.delete('/:collection/:id', async (c) => {
    const { collection, id } = c.req.param()
    const auth     = await extractAuth(c.req.raw)
    const existing = getCollection(collection).getById(id)
    if (!existing) return c.json({ error: 'Not found' }, 404)
    await permissionEngine.assert(collection, 'delete', auth?.user ?? null, existing)
    const ctx: HookContext = { userId: auth?.user.id, role: auth?.user.role, collection }
    await getCollection(collection).delete(id, ctx)
    realtimeService.broadcast(collection, 'delete', { id })
    return c.json({ ok: true })
  })

  api.post('/:collection/:id/upload', async (c) => {
    const { collection, id } = c.req.param()
    const auth     = await extractAuth(c.req.raw)
    const existing = getCollection(collection).getById(id)
    if (!existing) return c.json({ error: 'Not found' }, 404)
    await permissionEngine.assert(collection, 'upload', auth?.user ?? null, existing)
    const field = c.req.query('field')
    const files = await uploadService.handleUpload(c.req.raw, { collection, recordId: id, field, userId: auth?.user.id })
    if (field && files[0]) {
      const ctx: HookContext = { userId: auth?.user.id, role: auth?.user.role, collection }
      await getCollection(collection).update(id, { [field]: files[0].url }, ctx)
    }
    return c.json({ files }, 201)
  })
}
