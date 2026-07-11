#!/usr/bin/env bun
import { parseArgs } from 'util'
// Statically imported (not `await import()`) so `bun build --compile` embeds
// their npm dependencies (mysql2/pg/mssql/croner) into the standalone
// binary. A dynamic import anywhere in this chain makes the compiled exe
// crash with "Cannot find package" at runtime, even for packages that never
// end up used — see the comment on drivers/index.ts for the full story.
import { initDB }               from '../core/db.ts'
import { loadDBConfig }         from '../core/config.ts'
import { syncCollections, listStoredCollections } from '../core/collections.ts'
import { pluginRunner }         from '../plugins/loader.ts'
import { createApp }            from '../core/router.ts'
import { realtimeService }      from '../core/realtime.ts'
import { initUploads }          from '../core/uploads.ts'
import { startCronJobs, stopCronJobs, getAllCronJobDefs } from '../core/cron.ts'
import { prebuildAdminBundle }  from '../api/admin/index.ts'
import { authService }          from '../core/auth.ts'
import { writeSDK }             from '../api/sdk-gen.ts'

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port:   { type: 'string', short: 'p', default: '3000' },
    host:   { type: 'string', default: '0.0.0.0' },
    db:     { type: 'string', default: './onebase.db' },
    schema: { type: 'string', default: './schema' },
    jobs:   { type: 'string', default: './jobs' },
    output: { type: 'string', short: 'o', default: './sdk/index.ts' },
    help:   { type: 'boolean', default: false },
  },
  allowPositionals: true,
})

const command = positionals[0] ?? 'start'

// Dynamically imports every .ts/.js file in `dir` — used for both
// `schema/` (defineCollection/definePermissions) and `jobs/`
// (defineCronJob), which register themselves as a side effect of import.
// Unlike the internal modules above, these paths aren't known until runtime
// (they're whatever the user drops in the folder), so they can't be static
// imports — that's fine here since these are the user's own plain .ts/.js
// files read straight off disk next to the binary, not npm packages that
// need bundling.
async function loadDir(dir: string, label: string) {
  const fs   = await import('fs')
  const path = await import('path')
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir).filter((f: string) => f.match(/\.[jt]s$/))) {
    await import(path.resolve(dir, f))
    console.log(`[onebase] ${label}: ${f}`)
  }
}

// ─── First-run: create super admin ───────────────────────────────────────────

async function ensureAdminExists(port: string) {
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
  await initDB(loadDBConfig(values.db))
  initUploads()
  await loadDir(values.schema, 'Schema')
  await syncCollections()
  await ensureAdminExists(values.port)
  await pluginRunner.setup()
  await loadDir(values.jobs, 'Job')
  startCronJobs()

  // Pre-build the admin UI bundle before accepting requests
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

  process.on('SIGINT', () => { console.log('\n[onebase] Bye!'); stopCronJobs(); server.stop(); process.exit(0) })
}

else if (command === 'migrate') {
  await initDB(loadDBConfig(values.db))
  await loadDir(values.schema, 'Schema')
  await syncCollections()
  console.log('[onebase] Migrations applied ✓')
  process.exit(0)
}

else if (command === 'info') {
  await initDB(loadDBConfig(values.db))
  await loadDir(values.schema, 'Schema')
  await loadDir(values.jobs, 'Job')
  console.log('\nCollections:')
  ;(await listStoredCollections()).forEach(c => console.log(`  • ${c.name}`))
  console.log('\nPlugins:')
  pluginRunner.registeredPlugins.forEach(p => console.log(`  • ${p.name}@${p.version}`))
  console.log('\nCron jobs:')
  getAllCronJobDefs().forEach(j => console.log(`  • ${j.name}  (${j.schedule})`))
  process.exit(0)
}

else if (command === 'generate') {
  await loadDir(values.schema, 'Schema')
  await writeSDK(values.output)
  process.exit(0)
}

else {
  console.error(`Unknown command "${command}". Try: start | migrate | info | generate`)
  process.exit(1)
}
