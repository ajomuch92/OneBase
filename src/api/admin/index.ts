import { Hono } from 'hono'
import { extractAuth, requireAdmin } from '../../core/auth.ts'
import {
  getAllCollectionDefs, getCollection,
  createCollection, updateCollection, deleteCollection, listStoredCollections,
} from '../../core/collections.ts'
import { realtimeService } from '../../core/realtime.ts'
import { getSQLite } from '../../core/db.ts'
import type { CollectionSchemaJSON } from '../../core/db.ts'
import { join } from 'path'

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
  const stored = listStoredCollections()
  const collections = stored.map(s => ({
    name:  s.name,
    count: (() => { try { return (getSQLite().query(`SELECT COUNT(*) as c FROM "${s.name}"`).get() as any).c } catch { return 0 } })(),
  }))
  return c.json({ collections, realtimeConnections: realtimeService.connectionCount })
})

adminRouter.get('/api/collections', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const stored = listStoredCollections()
  return c.json(stored.map(s => ({
    name:   s.name,
    fields: s.schema.fields,
    count:  (() => { try { return (getSQLite().query(`SELECT COUNT(*) as c FROM "${s.name}"`).get() as any).c } catch { return 0 } })(),
  })))
})

adminRouter.post('/api/collections', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const { name, schema } = await c.req.json<{ name: string; schema: CollectionSchemaJSON }>()
  createCollection(name, schema)
  return c.json({ ok: true, name }, 201)
})

adminRouter.put('/api/collections/:name', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const { schema } = await c.req.json<{ schema: CollectionSchemaJSON }>()
  updateCollection(c.req.param('name'), schema)
  return c.json({ ok: true })
})

adminRouter.delete('/api/collections/:name', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  deleteCollection(c.req.param('name'))
  return c.json({ ok: true })
})

adminRouter.get('/api/collections/:name/records', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const name   = c.req.param('name')
  const limit  = Math.min(Number(c.req.query('limit')  ?? 20), 500)
  const offset = Number(c.req.query('offset') ?? 0)
  try {
    const db    = getSQLite()
    const items = db.query(`SELECT * FROM "${name}" ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset)
    const total = (db.query(`SELECT COUNT(*) as c FROM "${name}"`).get() as any).c
    return c.json({ items, total, limit, offset })
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

adminRouter.get('/api/users', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAdmin(auth)
  const limit  = Math.min(Number(c.req.query('limit') ?? 50), 500)
  const offset = Number(c.req.query('offset') ?? 0)
  const db     = getSQLite()
  const items  = db.query('SELECT id, email, role, verified, created_at FROM _ob_users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset)
  const total  = (db.query('SELECT COUNT(*) as c FROM _ob_users').get() as any).c
  return c.json({ items, total })
})
