// ─── Public API of OneBase ────────────────────────────────────────────────────
// Import from 'OneBase' in your schema files

export { defineCollection, getCollection } from "./core/collections.ts";
export { registerPlugin } from "./plugins/loader.ts";
export { definePermissions, PRESETS } from "./core/permissions.ts";

export type {
  CollectionDefinition,
  CollectionRecord,
  QueryOptions,
  HookContext,
} from "./core/collections.ts";

export type {
  FieldDefinition,
  FieldType,
  CollectionSchemaJSON,
} from "./core/db.ts";

export type {
  OneBasePlugin,
  PluginHookFn,
  PluginAPI,
  PluginStore,
} from "./plugins/types.ts";

export type {
  CollectionPermissions,
  PermissionRule,
  Action,
  RuleContext,
} from "./core/permissions.ts";

export type { UploadedFile } from "./core/uploads.ts";
