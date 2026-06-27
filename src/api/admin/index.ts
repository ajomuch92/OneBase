import { Hono } from 'hono'
import { extractAuth, requireRole } from '../../core/auth.ts'
import { getAllCollectionDefs, getCollection } from '../../core/collections.ts'
import { realtimeService } from '../../core/realtime.ts'
import { adminUI } from './ui.ts'

export const adminRouter = new Hono()

// ── Serve Admin UI ────────────────────────────────────────────────────────────

adminRouter.get('/', (c) => c.html(adminUI))
adminRouter.get('/app', (c) => c.html(adminUI))

// ── Admin API (requires admin role) ───────────────────────────────────────────

// GET /admin/api/stats
adminRouter.get('/api/stats', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireRole(auth, 'admin')

  const defs = getAllCollectionDefs()
  const collections = defs.map((def) => ({
    name:  def.name,
    count: getCollection(def.name).count(),
  }))

  return c.json({
    collections,
    realtimeConnections: realtimeService.connectionCount,
  })
})

// GET /admin/api/collections
adminRouter.get('/api/collections', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireRole(auth, 'admin')

  const defs = getAllCollectionDefs().map((def) => ({
    name:   def.name,
    fields: def.fields,
    count:  getCollection(def.name).count(),
  }))

  return c.json(defs)
})

// GET /admin/api/collections/:name/records
adminRouter.get('/api/collections/:name/records', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireRole(auth, 'admin')

  const { name }   = c.req.param()
  const qs         = c.req.query()
  const limit      = Math.min(Number(qs.limit ?? 50), 500)
  const offset     = Number(qs.offset ?? 0)
  const service    = getCollection(name)
  const records    = service.list({ limit, offset })
  const total      = service.count()

  return c.json({ items: records, total, limit, offset })
})
