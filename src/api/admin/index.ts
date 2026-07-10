import { Hono } from 'hono'
import { extractAuth, requireAdmin } from '../../core/auth.ts'
import {
  getAllCollectionDefs, getCollection,
  createCollection, updateCollection, deleteCollection, listStoredCollections,
} from '../../core/collections.ts'
import { realtimeService } from '../../core/realtime.ts'
import { getDB } from '../../core/db.ts'
import type { CollectionSchemaJSON, DBAdapter } from '../../core/db.ts'
import { join } from 'path'

async function countTable(db: DBAdapter, name: string): Promise<number> {
  try {
    const row = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${db.quoteIdent(name)}`)
    return row?.c ?? 0
  } catch {
    return 0
  }
}

export const adminRouter = new Hono()

// ─── Bundle cache ─────────────────────────────────────────────────────────────

let _bundle: string | null = null

export async function prebuildAdminBundle() {
  const entrypoint = join(import.meta.dir, 'client/index.tsx')
  console.log('[admin] Building UI bundle...')

  const result = await Bun.build({
    entrypoints: [entrypoint],
    target:      'browser',
    minify:      false,
    define: {
      'process.env.NODE_ENV': '"development"',
    },
    // Tell Bun to use hono/jsx/dom as the JSX runtime for the client bundle
    // so we don't need react or react-dom installed
    external: [],
  })

  if (!result.success) {
    const msgs = result.logs.map(l => l.message).join('\n')
    console.error('[admin] Bundle failed:\n' + msgs)
    // Serve an error script so the browser shows something useful
    _bundle = `console.error("[OneBase] Admin UI bundle failed to compile. Check server logs.\\n${msgs.replace(/"/g, "'")}")`
    return
  }

  _bundle = await result.outputs[0].text()
  console.log(`[admin] UI bundle ready (${(_bundle.length / 1024).toFixed(1)} KB)`)
}

// ─── Shell HTML ───────────────────────────────────────────────────────────────

const SHELL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>OneBase Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0f1117; --surface: #1a1d27; --border: #2a2d3a;
      --text: #e2e4f0; --muted: #6b7280; --accent: #6366f1; --accent2: #818cf8;
      --green: #10b981; --red: #ef4444; --r: 8px;
      --font: system-ui, -apple-system, sans-serif;
    }
    body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; }
    #app { min-height: 100vh; }
    .ob-boot { display: flex; align-items: center; justify-content: center; min-height: 100vh;
      color: var(--muted); font-size: 13px; gap: 10px; }
    .ob-boot-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
      animation: pulse 1s infinite; }
    @keyframes pulse { 0%,100% { opacity: .3 } 50% { opacity: 1 } }
  </style>
</head>
<body>
  <div id="app">
    <div class="ob-boot"><div class="ob-boot-dot"></div> Loading OneBase…</div>
  </div>
  <script type="module" src="/admin/client.js"></script>
</body>
</html>`

// ─── Routes ───────────────────────────────────────────────────────────────────

adminRouter.get('/', (c) => c.html(SHELL_HTML))

adminRouter.get('/client.js', (c) => {
  if (!_bundle) {
    return c.text('console.error("[OneBase] Bundle not ready yet, reload in a moment")', 503,
      { 'Content-Type': 'application/javascript' })
  }
  return c.text(_bundle, 200, {
    'Content-Type':  'application/javascript',
    'Cache-Control': 'no-cache',
  })
})

// ─── Admin API ────────────────────────────────────────────────────────────────

adminRouter.get('/api/stats', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const db     = getDB()
  const stored = await listStoredCollections()
  const collections = await Promise.all(stored.map(async s => ({
    name:  s.name,
    count: await countTable(db, s.name),
  })))
  return c.json({ collections, realtimeConnections: realtimeService.connectionCount })
})

adminRouter.get('/api/collections', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const db     = getDB()
  const stored = await listStoredCollections()
  const collections = await Promise.all(stored.map(async s => ({
    name:   s.name,
    fields: s.schema.fields,
    count:  await countTable(db, s.name),
  })))
  return c.json(collections)
})

adminRouter.post('/api/collections', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const { name, schema } = await c.req.json<{ name: string; schema: CollectionSchemaJSON }>()
  await createCollection(name, schema)
  return c.json({ ok: true, name }, 201)
})

adminRouter.put('/api/collections/:name', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const { schema } = await c.req.json<{ schema: CollectionSchemaJSON }>()
  await updateCollection(c.req.param('name'), schema)
  return c.json({ ok: true })
})

adminRouter.delete('/api/collections/:name', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  await deleteCollection(c.req.param('name'))
  return c.json({ ok: true })
})

adminRouter.get('/api/collections/:name/records', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const name   = c.req.param('name')
  const limit  = Math.min(Number(c.req.query('limit')  ?? 20), 500)
  const offset = Number(c.req.query('offset') ?? 0)
  try {
    const db       = getDB()
    const items    = await db.query(`SELECT * FROM ${db.quoteIdent(name)} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset])
    const totalRow = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${db.quoteIdent(name)}`)
    return c.json({ items, total: totalRow?.c ?? 0, limit, offset })
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

adminRouter.get('/api/users', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const limit  = Math.min(Number(c.req.query('limit') ?? 50), 500)
  const offset = Number(c.req.query('offset') ?? 0)
  const db        = getDB()
  const items     = await db.query('SELECT id, email, role, verified, created_at FROM _ob_users ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset])
  const totalRow  = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM _ob_users')
  return c.json({ items, total: totalRow?.c ?? 0 })
})

// POST /admin/api/users — create user
adminRouter.post('/api/users', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const { email, password, role } = await c.req.json<{ email: string; password: string; role?: string }>()
  const { authService } = await import('../../core/auth.ts')
  const user = await authService.register(email, password, role ?? 'user')
  return c.json({ user }, 201)
})

// PATCH /admin/api/users/:id — update role, password, verified
adminRouter.patch('/api/users/:id', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const { role, password, verified } = await c.req.json<{ role?: string; password?: string; verified?: boolean }>()
  const db = getDB()
  const user = await db.get<any>('SELECT * FROM _ob_users WHERE id = ?', [c.req.param('id')])
  if (!user) return c.json({ error: 'User not found' }, 404)

  const updates: string[] = []
  const params: unknown[] = []

  if (role !== undefined) { updates.push('role = ?'); params.push(role) }
  if (verified !== undefined) { updates.push('verified = ?'); params.push(verified ? 1 : 0) }
  if (password) {
    const { hash } = await import('bcryptjs')
    const passwordHash = await hash(password, 12)
    updates.push('password_hash = ?'); params.push(passwordHash)
  }

  if (updates.length > 0) {
    updates.push(`updated_at = ${db.nowSQL()}`)
    params.push(c.req.param('id'))
    await db.run(`UPDATE _ob_users SET ${updates.join(', ')} WHERE id = ?`, params)
  }

  const updated = await db.get('SELECT id, email, role, verified, created_at FROM _ob_users WHERE id = ?', [c.req.param('id')])
  return c.json({ user: updated })
})

// DELETE /admin/api/users/:id — delete user
adminRouter.delete('/api/users/:id', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)

  // Prevent deleting yourself
  if (auth.user.id === c.req.param('id')) {
    return c.json({ error: 'Cannot delete your own account' }, 400)
  }

  const db = getDB()
  const user = await db.get('SELECT id FROM _ob_users WHERE id = ?', [c.req.param('id')])
  if (!user) return c.json({ error: 'User not found' }, 404)

  await db.run('DELETE FROM _ob_users WHERE id = ?', [c.req.param('id')])
  return c.json({ ok: true })
})
