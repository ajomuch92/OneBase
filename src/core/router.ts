import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { extractAuth, requireAuth } from './auth.ts'
import { getAllCollectionDefs, getCollection } from './collections.ts'
import { realtimeService } from './realtime.ts'
import { permissionEngine } from './permissions.ts'
import { uploadService } from './uploads.ts'
import type { HookContext } from './collections.ts'
import type { AuthUser } from './auth.ts'

// Sub-routers
import { authRouter } from '../api/rest.ts'
import { adminRouter } from '../api/admin/index.ts'

// ─── App ─────────────────────────────────────────────────────────────────────

export function createApp() {
  const app = new Hono()

  app.use('*', logger())
  app.use('*', secureHeaders())
  app.use('*', cors({
    origin:      process.env.JUST_TS_CORS_ORIGIN ?? '*',
    credentials: true,
  }))

  app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }))

  app.route('/api/auth', authRouter)
  app.route('/admin', adminRouter)

  // Static file serving for uploads
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
    const status =
      err.message === 'Unauthorized' ? 401
      : err.message === 'Forbidden'  ? 403
      : err.message.includes('not found') ? 404
      : 400
    return c.json({ error: err.message }, status)
  })

  return app
}

// ─── Auto-register routes per collection ─────────────────────────────────────

function registerCollectionRoutes(api: Hono) {
  for (const def of getAllCollectionDefs()) {
    const { name } = def

    // ── GET /api/:collection ── list ──────────────────────────────────────

    api.get(`/${name}`, async (c) => {
      const auth = await extractAuth(c.req.raw)
      const user: AuthUser | null = auth?.user ?? null

      await permissionEngine.assert(name, 'list', user)

      const qs     = c.req.query()
      const limit  = Math.min(Number(qs.limit ?? 50), 500)
      const offset = Number(qs.offset ?? 0)
      const sort   = qs.sort  ?? 'created_at'
      const order  = (qs.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc'

      const filter: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(qs)) {
        if (!['limit', 'offset', 'sort', 'order', 'expand'].includes(k)) {
          filter[k] = v
        }
      }

      const service = getCollection(name)
      const records = service.list({ filter, sort, order, limit, offset })
      const total   = service.count(filter)

      return c.json({ items: records, total, limit, offset })
    })

    // ── GET /api/:collection/:id ── read one ──────────────────────────────

    api.get(`/${name}/:id`, async (c) => {
      const auth   = await extractAuth(c.req.raw)
      const user   = auth?.user ?? null
      const record = getCollection(name).getById(c.req.param('id'))

      if (!record) return c.json({ error: 'Not found' }, 404)

      await permissionEngine.assert(name, 'read', user, record)

      return c.json(record)
    })

    // ── POST /api/:collection ── create ───────────────────────────────────

    api.post(`/${name}`, async (c) => {
      const auth = await extractAuth(c.req.raw)
      const user = auth?.user ?? null
      const body = await c.req.json<Record<string, unknown>>()

      await permissionEngine.assert(name, 'create', user, undefined, body)

      const ctx: HookContext = {
        userId:     user?.id,
        role:       user?.role,
        collection: name,
      }

      const record = await getCollection(name).create(body, ctx)
      realtimeService.broadcast(name, 'create', record)
      return c.json(record, 201)
    })

    // ── PATCH /api/:collection/:id ── update ──────────────────────────────

    api.patch(`/${name}/:id`, async (c) => {
      const auth     = await extractAuth(c.req.raw)
      const user     = auth?.user ?? null
      const existing = getCollection(name).getById(c.req.param('id'))

      if (!existing) return c.json({ error: 'Not found' }, 404)

      const body = await c.req.json<Record<string, unknown>>()
      await permissionEngine.assert(name, 'update', user, existing, body)

      const ctx: HookContext = {
        userId:     user?.id,
        role:       user?.role,
        collection: name,
      }

      const record = await getCollection(name).update(c.req.param('id'), body, ctx)
      realtimeService.broadcast(name, 'update', record)
      return c.json(record)
    })

    // ── DELETE /api/:collection/:id ── delete ─────────────────────────────

    api.delete(`/${name}/:id`, async (c) => {
      const auth     = await extractAuth(c.req.raw)
      const user     = auth?.user ?? null
      const existing = getCollection(name).getById(c.req.param('id'))

      if (!existing) return c.json({ error: 'Not found' }, 404)

      await permissionEngine.assert(name, 'delete', user, existing)

      const ctx: HookContext = {
        userId:     user?.id,
        role:       user?.role,
        collection: name,
      }

      await getCollection(name).delete(c.req.param('id'), ctx)
      realtimeService.broadcast(name, 'delete', { id: c.req.param('id') })
      return c.json({ ok: true })
    })

    // ── POST /api/:collection/:id/upload ── file upload ───────────────────

    api.post(`/${name}/:id/upload`, async (c) => {
      const auth     = await extractAuth(c.req.raw)
      const user     = auth?.user ?? null
      const existing = getCollection(name).getById(c.req.param('id'))

      if (!existing) return c.json({ error: 'Not found' }, 404)

      await permissionEngine.assert(name, 'upload', user, existing)

      const field = c.req.query('field')

      const files = await uploadService.handleUpload(c.req.raw, {
        collection: name,
        recordId:   c.req.param('id'),
        field:      field ?? undefined,
        userId:     user?.id,
      })

      // If a field name was given, attach the file URL to the record
      if (field && files[0]) {
        const ctx: HookContext = { userId: user?.id, role: user?.role, collection: name }
        await getCollection(name).update(c.req.param('id'), { [field]: files[0].url }, ctx)
      }

      return c.json({ files }, 201)
    })

    // ── GET /api/:collection/:id/files ── list files ──────────────────────

    api.get(`/${name}/:id/files`, async (c) => {
      const auth     = await extractAuth(c.req.raw)
      const user     = auth?.user ?? null
      const existing = getCollection(name).getById(c.req.param('id'))

      if (!existing) return c.json({ error: 'Not found' }, 404)

      await permissionEngine.assert(name, 'read', user, existing)

      const files = uploadService.listForRecord(name, c.req.param('id'))
      return c.json({ files })
    })

    // ── DELETE /api/files/:fileId ── delete a file ────────────────────────

    api.delete('/files/:fileId', async (c) => {
      const auth = await extractAuth(c.req.raw)
      requireAuth(auth)

      await uploadService.deleteFile(c.req.param('fileId'), auth.user.id)
      return c.json({ ok: true })
    })
  }
}
