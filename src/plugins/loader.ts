import type { HookEvent, OneBasePlugin, PluginHookFn } from "./types.ts";

import type { HookContext } from "../core/collections.ts";
import { getSQLite } from "../core/db.ts";

// ─── Plugin runner ────────────────────────────────────────────────────────────

class PluginRunner {
  private plugins: OneBasePlugin[] = [];

  register(plugin: OneBasePlugin) {
    const existing = this.plugins.find((p) => p.name === plugin.name);
    if (existing) {
      console.warn(
        `[OneBase] Plugin "${plugin.name}" is already registered — skipping`,
      );
      return;
    }
    this.plugins.push(plugin);
    console.log(
      `[OneBase] Plugin registered: ${plugin.name}@${plugin.version}`,
    );
  }

  async setup() {
    for (const plugin of this.plugins) {
      if (plugin.setup) {
        const api = createPluginAPI();
        await plugin.setup(api);
        console.log(`[OneBase] Plugin ready: ${plugin.name}`);
      }
    }
  }

  async runHook(
    event: HookEvent,
    collection: string,
    data: Record<string, unknown>,
    ctx: HookContext,
  ) {
    for (const plugin of this.plugins) {
      const hookFn: PluginHookFn | undefined = plugin.hooks?.[event];
      if (!hookFn) continue;

      const targeted = plugin.collections;
      if (targeted && !targeted.includes(collection)) continue;

      try {
        await hookFn(collection, data, ctx);
      } catch (err) {
        console.error(
          `[OneBase] Plugin "${plugin.name}" hook "${event}" failed:`,
          err,
        );
      }
    }
  }

  get registeredPlugins() {
    return this.plugins.map((p) => ({ name: p.name, version: p.version }));
  }
}

// ─── Plugin API factory ───────────────────────────────────────────────────────

function createPluginAPI() {
  return {
    addRoutes: (_prefix: string, _handler: unknown) => {
      // TODO: connect to Hono app
      console.warn("[OneBase] addRoutes not yet connected to app instance");
    },
    store: {
      async get(key: string): Promise<string | null> {
        ensurePluginStoreTable();
        const row = getSQLite()
          .query("SELECT value FROM _just_plugin_store WHERE key = ?")
          .get(key) as { value: string } | null;
        return row?.value ?? null;
      },
      async set(key: string, value: string): Promise<void> {
        ensurePluginStoreTable();
        getSQLite()
          .query(
            "INSERT OR REPLACE INTO _just_plugin_store (key, value) VALUES (?, ?)",
          )
          .run(key, value);
      },
      async del(key: string): Promise<void> {
        ensurePluginStoreTable();
        getSQLite()
          .query("DELETE FROM _just_plugin_store WHERE key = ?")
          .run(key);
      },
    },
  };
}

function ensurePluginStoreTable() {
  getSQLite().run(`
    CREATE TABLE IF NOT EXISTS _just_plugin_store (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const pluginRunner = new PluginRunner();

// ─── Public API for user-facing plugin definition ─────────────────────────────

export function registerPlugin(plugin: OneBasePlugin) {
  pluginRunner.register(plugin);
}
