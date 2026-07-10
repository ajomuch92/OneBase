#!/usr/bin/env bun
import { parseArgs } from 'util'

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port:   { type: 'string', short: 'p', default: '3000' },
    host:   { type: 'string', default: '0.0.0.0' },
    db:     { type: 'string', default: './onebase.db' },
    schema: { type: 'string', default: './schema' },
    output: { type: 'string', short: 'o', default: './sdk/index.ts' },
    help:   { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

const command = positionals[0] ?? 'start'

async function loadSchema(dir: string) {
  const fs   = await import('fs')
  const path = await import('path')
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir).filter((f: string) => f.match(/\.[jt]s$/))) {
    await import(path.resolve(dir, f))
    console.log(`[onebase] Schema: ${f}`)
  }
}

// ─── First-run: create super admin ───────────────────────────────────────────

async function ensureAdminExists(port: string) {
  const { authService } = await import('../core/auth.ts')
  if (await authService.userCount() > 0) return

  console.log(`
┌──────────────────────────────────────────┐
│  Welcome to OneBase!                     │
│  No users found. Create your super admin │
│  account to get started.                 │
└──────────────────────────────────────────┘
`)

  let email    = process.env.ONEBASE_ADMIN_EMAIL    ?? ''
  let password = process.env.ONEBASE_ADMIN_PASSWORD ?? ''

  if (email && password) {
    console.log('[onebase] Creating admin from environment variables...')
  } else {
    process.stdout.write('  Email:    ')
    email = await readLine()

    process.stdout.write('  Password: ')
    password = await readLine(true)
  }

  if (!email.includes('@'))    { console.error('✗ Invalid email');                    process.exit(1) }
  if (password.length < 8)     { console.error('✗ Password min 8 characters');        process.exit(1) }

  await authService.register(email.trim(), password.trim(), 'admin')
  console.log(`
  ✓ Super admin created: ${email.trim()}
  → http://localhost:${port}/admin
`)
}

async function readLine(hidden = false): Promise<string> {
  const rl = (await import('readline')).createInterface({ input: process.stdin, terminal: false })
  if (hidden) { try { Bun.spawnSync(['stty', '-echo'], { stdin: 'inherit' }) } catch {} }
  const value = await new Promise<string>(resolve => rl.once('line', line => { rl.close(); resolve(line.trim()) }))
  if (hidden) {
    try { Bun.spawnSync(['stty', 'echo'], { stdin: 'inherit' }) } catch {}
    process.stdout.write('\n')
  }
  return value
}

// ─── Commands ─────────────────────────────────────────────────────────────────

if (command === 'start') {
  const { initDB }          = await import('../core/db.ts')
  const { loadDBConfig }    = await import('../core/config.ts')
  const { syncCollections } = await import('../core/collections.ts')
  const { pluginRunner }    = await import('../plugins/loader.ts')
  const { createApp }       = await import('../core/router.ts')
  const { realtimeService } = await import('../core/realtime.ts')
  const { initUploads }     = await import('../core/uploads.ts')

  await initDB(loadDBConfig(values.db))
  initUploads()
  await loadSchema(values.schema)
  await syncCollections()
  await ensureAdminExists(values.port)
  await pluginRunner.setup()

  // Pre-build the admin UI bundle before accepting requests
  const { prebuildAdminBundle } = await import('../api/admin/index.ts')
  await prebuildAdminBundle()

  const port = Number(values.port)
  const app  = createApp()

  const server = Bun.serve({
    port,
    hostname: values.host,
    fetch(req) {
      // Inject the server instance so the /realtime route can call server.upgrade()
      return app.fetch(req, { server })
    },
    websocket: {
      open(ws)              { realtimeService.onOpen(ws) },
      message(ws, msg)      { realtimeService.onMessage(ws, msg as string) },
      close(ws)             { realtimeService.onClose(ws) },
    },
  })

  console.log(`
╔══════════════════════════════════════════╗
║  OneBase running                         ║
║  API    → http://localhost:${port}          ║
║  Admin  → http://localhost:${port}/admin    ║
╚══════════════════════════════════════════╝
`)

  process.on('SIGINT', () => { console.log('\n[onebase] Bye!'); server.stop(); process.exit(0) })
}

else if (command === 'migrate') {
  const { initDB }          = await import('../core/db.ts')
  const { loadDBConfig }    = await import('../core/config.ts')
  const { syncCollections } = await import('../core/collections.ts')
  await initDB(loadDBConfig(values.db))
  await loadSchema(values.schema)
  await syncCollections()
  console.log('[onebase] Migrations applied ✓')
  process.exit(0)
}

else if (command === 'info') {
  const { initDB }                = await import('../core/db.ts')
  const { loadDBConfig }          = await import('../core/config.ts')
  const { listStoredCollections } = await import('../core/collections.ts')
  const { pluginRunner }          = await import('../plugins/loader.ts')
  await initDB(loadDBConfig(values.db))
  await loadSchema(values.schema)
  console.log('\nCollections:')
  ;(await listStoredCollections()).forEach(c => console.log(`  • ${c.name}`))
  console.log('\nPlugins:')
  pluginRunner.registeredPlugins.forEach(p => console.log(`  • ${p.name}@${p.version}`))
  process.exit(0)
}

else {
  console.error(`Unknown command "${command}". Try: start | migrate | info`)
  process.exit(1)
}
