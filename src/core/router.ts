import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { extractAuth, requireAuth } from './auth.ts'
import { getCollection, listStoredCollections, expandRecords } from './collections.ts'
import { getDB } from './db.ts'
import { realtimeService } from './realtime.ts'
import { permissionEngine } from './permissions.ts'
import { uploadService } from './uploads.ts'
import { rateLimiter } from './rateLimit.ts'
import type { HookContext } from './collections.ts'
import { authRouter } from '../api/rest.ts'
import { adminRouter } from '../api/admin/index.ts'

export function createApp() {
  const app = new Hono<{ Variables: { server: any } }>()

  app.use('*', logger())
  app.use('*', secureHeaders())
  app.use('*', cors({ origin: process.env.ONEBASE_CORS_ORIGIN ?? '*', credentials: true }))

  // Blanket protection for the REST/admin surface. /health, /files/* and
  // /realtime are intentionally excluded — health checks and static file
  // serving have different traffic shapes and shouldn't share this budget.
  const apiLimiter = rateLimiter({
    windowMs: Number(process.env.ONEBASE_RATE_LIMIT_WINDOW_MS ?? 60_000),
    max:      Number(process.env.ONEBASE_RATE_LIMIT_MAX ?? 300),
  })
  app.use('/api/*', apiLimiter)
  app.use('/admin/*', apiLimiter)

  app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }))

  app.route('/api/auth', authRouter)
  app.route('/admin', adminRouter)

  app.get('/files/*', async (c) => {
    const path = c.req.path.replace('/files/', '')
    return uploadService.serveFile(path)
  })

  // WebSocket upgrade — needs access to the Bun server instance
  // which is injected via middleware after server starts
  app.get('/realtime', async (c) => {
    const server = c.get('server')
    const auth   = await extractAuth(c.req.raw)
    const upgraded = realtimeService.upgrade(c.req.raw, server, auth)
    if (!upgraded) return c.text('WebSocket upgrade failed', 400)
    // Bun handles the response after upgrade — return empty response
    return new Response(null, { status: 101 })
  })

  const api = new Hono()
  registerCollectionRoutes(api)
  app.route('/api', api)

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((err, c) => {
    const status =
      err.message === 'Unauthorized'              ? 401
      : err.message === 'Forbidden'               ? 403
      : err.message.includes('not found')         ? 404
      : 400
    return c.json({ error: err.message }, status)
  })

  return app
}

function registerCollectionRoutes(api: Hono) {
  // `users` isn't a dynamic collection (it's the `_ob_users` system table,
  // otherwise only reachable via the admin-only `/admin/api/users`), but
  // `relation` fields routinely point at it (e.g. an "author" field) —
  // without this, the admin UI's relation picker and `expand` both fail
  // to resolve it. Read-only, and only ever the safe columns (no
  // password_hash). Registered before `/:collection` so the static path
  // wins the match.
  api.get('/users', async (c) => {
    const auth = await extractAuth(c.req.raw)
    await permissionEngine.assert('users', 'list', auth?.user ?? null)
    const qs     = c.req.query()
    const limit  = Math.min(Number(qs.limit ?? 50), 500)
    const offset = Number(qs.offset ?? 0)
    const db     = getDB()
    const items  = await db.query(
      'SELECT id, email, role, verified, created_at FROM _ob_users ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset],
    )
    const totalRow = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM _ob_users')
    return c.json({ items, total: totalRow?.c ?? 0, limit, offset })
  })

  api.get('/users/:id', async (c) => {
    const auth = await extractAuth(c.req.raw)
    const db   = getDB()
    const user = await db.get<Record<string, unknown>>(
      'SELECT id, email, role, verified, created_at FROM _ob_users WHERE id = ?',
      [c.req.param('id')],
    )
    if (!user) return c.json({ error: 'Not found' }, 404)
    await permissionEngine.assert('users', 'read', auth?.user ?? null, user as any)
    return c.json(user)
  })

  api.get('/:collection', async (c) => {
    const name = c.req.param('collection')
    const auth = await extractAuth(c.req.raw)
    await permissionEngine.assert(name, 'list', auth?.user ?? null)
    const qs     = c.req.query()
    const limit  = Math.min(Number(qs.limit ?? 50), 500)
    const offset = Number(qs.offset ?? 0)
    const sort   = qs.sort ?? 'created_at'
    const order  = (qs.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'
    const filter: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(qs)) {
      if (!['limit', 'offset', 'sort', 'order', 'expand'].includes(k)) filter[k] = v
    }
    const svc     = getCollection(name)
    let records   = await svc.list({ filter, sort, order, limit, offset })
    const total   = await svc.count(filter)
    if (qs.expand) records = await expandRecords(name, records, qs.expand, auth?.user ?? null)
    return c.json({ items: records, total, limit, offset })
  })

  api.get('/:collection/:id', async (c) => {
    const { collection, id } = c.req.param()
    const auth   = await extractAuth(c.req.raw)
    let record = await getCollection(collection).getById(id)
    if (!record) return c.json({ error: 'Not found' }, 404)
    await permissionEngine.assert(collection, 'read', auth?.user ?? null, record)
    const expand = c.req.query('expand')
    if (expand) [record] = await expandRecords(collection, [record], expand, auth?.user ?? null)
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
    const existing = await getCollection(collection).getById(id)
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
    const existing = await getCollection(collection).getById(id)
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
    const existing = await getCollection(collection).getById(id)
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
