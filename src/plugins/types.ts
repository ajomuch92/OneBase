import type { HookContext } from '../core/collections.ts'

export type HookEvent = 'beforeCreate' | 'afterCreate' | 'beforeUpdate' | 'afterUpdate' | 'beforeDelete' | 'afterDelete'

export interface JustTSPlugin {
  name: string; version: string
  setup?:       (api: PluginAPI) => Promise<void>
  hooks?:       Partial<Record<HookEvent, PluginHookFn>>
  collections?: string[]
}

export type PluginHookFn = (collection: string, data: Record<string, unknown>, ctx: HookContext) => Promise<void>

export interface PluginAPI {
  store: { get(k: string): Promise<string|null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void> }
}
