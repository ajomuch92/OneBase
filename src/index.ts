export { defineCollection, getCollection }    from './core/collections.ts'
export { registerPlugin }                     from './plugins/loader.ts'
export { definePermissions, PRESETS }         from './core/permissions.ts'

export type { CollectionDefinition, CollectionRecord, HookContext } from './core/collections.ts'
export type { FieldDefinition, FieldType }    from './core/db.ts'
export type { CollectionPermissions }         from './core/permissions.ts'
export type { JustTSPlugin }                  from './plugins/types.ts'
