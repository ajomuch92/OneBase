import type { HookContext } from "../core/collections.ts";

// ─── Hook events ──────────────────────────────────────────────────────────────

export type HookEvent =
  | "beforeCreate"
  | "afterCreate"
  | "beforeUpdate"
  | "afterUpdate"
  | "beforeDelete"
  | "afterDelete";

// ─── Plugin definition ────────────────────────────────────────────────────────

export interface OneBasePlugin {
  name: string;
  version: string;

  // Called once when OneBase starts, after DB is initialized
  setup?: (api: PluginAPI) => Promise<void>;

  // Hooks — called for matching collections (undefined = all collections)
  hooks?: Partial<Record<HookEvent, PluginHookFn>>;

  // Collections filter — only run hooks for these collections
  collections?: string[];
}

export type PluginHookFn = (
  collection: string,
  data: Record<string, unknown>,
  ctx: HookContext,
) => Promise<void>;

// ─── Plugin API passed to setup() ────────────────────────────────────────────

export interface PluginAPI {
  // Register additional HTTP routes via Hono app
  addRoutes: (prefix: string, handler: unknown) => void;

  // Read/write arbitrary plugin data in DB
  store: PluginStore;
}

export interface PluginStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  del: (key: string) => Promise<void>;
}
