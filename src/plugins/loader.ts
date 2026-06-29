import type { JustTSPlugin, HookEvent } from './types.ts'
import type { HookContext } from '../core/collections.ts'
import { getSQLite } from '../core/db.ts'

class PluginRunner {
  private plugins: JustTSPlugin[] = []

  register(plugin: JustTSPlugin) {
    if (this.plugins.find(p => p.name === plugin.name)) return
    this.plugins.push(plugin)
    console.log(`[onebase] Plugin registered: ${plugin.name}@${plugin.version}`)
  }

  async setup() {
    for (const p of this.plugins) {
      if (p.setup) await p.setup(createPluginAPI())
    }
  }

  async runHook(event: HookEvent, collection: string, data: Record<string, unknown>, ctx: HookContext) {
    for (const p of this.plugins) {
      const fn = p.hooks?.[event]
      if (!fn) continue
      if (p.collections && !p.collections.includes(collection)) continue
      try { await fn(collection, data, ctx) } catch (e) { console.error(`[plugin:${p.name}] ${event} error:`, e) }
    }
  }

  get registeredPlugins() { return this.plugins.map(p => ({ name: p.name, version: p.version })) }
}

function createPluginAPI() {
  return {
    store: {
      async get(key: string) {
        return (getSQLite().query('SELECT value FROM _ob_plugin_store WHERE key = ?').get(key) as any)?.value ?? null
      },
      async set(key: string, value: string) {
        getSQLite().run('INSERT OR REPLACE INTO _ob_plugin_store (key, value) VALUES (?, ?)', [key, value])
      },
      async del(key: string) {
        getSQLite().run('DELETE FROM _ob_plugin_store WHERE key = ?', [key])
      },
    },
  }
}

export const pluginRunner = new PluginRunner()
export function registerPlugin(plugin: JustTSPlugin) { pluginRunner.register(plugin) }
