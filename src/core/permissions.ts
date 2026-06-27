import type { AuthUser } from './auth.ts'
import type { CollectionRecord } from './collections.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

export type Action = 'list' | 'read' | 'create' | 'update' | 'delete' | 'upload'

/**
 * A permission rule. Can be:
 *  - 'public'         → no auth required
 *  - 'auth'           → any logged-in user
 *  - 'admin'          → admin role only
 *  - string[]         → specific roles allowed
 *  - RuleFn           → custom function (row-level logic)
 */
export type PermissionRule =
  | 'public'
  | 'auth'
  | 'admin'
  | string[]
  | RuleFn

export type RuleFn = (ctx: RuleContext) => boolean | Promise<boolean>

export interface RuleContext {
  user:    AuthUser | null
  record?: CollectionRecord   // for read/update/delete — the actual row
  data?:   Record<string, unknown>  // for create — the incoming payload
  action:  Action
}

/**
 * Permission map for a collection.
 * Each action maps to a PermissionRule.
 * Unspecified actions default to 'auth'.
 */
export type CollectionPermissions = Partial<Record<Action, PermissionRule>>

// ─── Permission engine ────────────────────────────────────────────────────────

class PermissionEngine {
  private rules = new Map<string, CollectionPermissions>()

  register(collection: string, perms: CollectionPermissions) {
    this.rules.set(collection, perms)
  }

  async check(
    collection: string,
    action:     Action,
    user:       AuthUser | null,
    record?:    CollectionRecord,
    data?:      Record<string, unknown>,
  ): Promise<boolean> {
    const perms = this.rules.get(collection) ?? {}
    const rule  = perms[action] ?? 'auth'    // default: require auth

    return this.evaluate(rule, { user, record, data, action })
  }

  async assert(
    collection: string,
    action:     Action,
    user:       AuthUser | null,
    record?:    CollectionRecord,
    data?:      Record<string, unknown>,
  ): Promise<void> {
    const allowed = await this.check(collection, action, user, record, data)
    if (!allowed) {
      throw new Error(user ? 'Forbidden' : 'Unauthorized')
    }
  }

  private async evaluate(rule: PermissionRule, ctx: RuleContext): Promise<boolean> {
    // No user present — only 'public' passes
    if (!ctx.user) {
      return rule === 'public'
    }

    if (rule === 'public') return true
    if (rule === 'auth')   return true     // user is logged in

    if (rule === 'admin') {
      return ctx.user.role === 'admin'
    }

    if (Array.isArray(rule)) {
      return rule.includes(ctx.user.role)
    }

    if (typeof rule === 'function') {
      return rule(ctx)
    }

    return false
  }
}

export const permissionEngine = new PermissionEngine()

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Define permissions for a collection.
 *
 * @example
 * definePermissions('posts', {
 *   list:   'public',                          // anyone can list
 *   read:   'public',                          // anyone can read
 *   create: 'auth',                            // logged in users
 *   update: ({ user, record }) =>              // only the author
 *     user?.id === record?.authorId,
 *   delete: ['admin', 'moderator'],            // specific roles
 * })
 */
export function definePermissions(
  collection: string,
  perms:      CollectionPermissions,
) {
  permissionEngine.register(collection, perms)
}

// ─── Built-in permission presets ──────────────────────────────────────────────

export const PRESETS = {
  /** Everything public, no auth needed */
  PUBLIC: {
    list:   'public',
    read:   'public',
    create: 'public',
    update: 'public',
    delete: 'public',
    upload: 'public',
  } satisfies CollectionPermissions,

  /** Read public, write requires auth */
  PUBLIC_READ: {
    list:   'public',
    read:   'public',
    create: 'auth',
    update: 'auth',
    delete: 'auth',
    upload: 'auth',
  } satisfies CollectionPermissions,

  /** Only admins can do anything */
  ADMIN_ONLY: {
    list:   'admin',
    read:   'admin',
    create: 'admin',
    update: 'admin',
    delete: 'admin',
    upload: 'admin',
  } satisfies CollectionPermissions,

  /** Auth required for everything */
  PRIVATE: {
    list:   'auth',
    read:   'auth',
    create: 'auth',
    update: 'auth',
    delete: 'auth',
    upload: 'auth',
  } satisfies CollectionPermissions,

  /**
   * Owner-based: users can only update/delete their own records.
   * Assumes the record has an `authorId` or `userId` field.
   */
  OWNER(ownerField = 'authorId'): CollectionPermissions {
    return {
      list:   'auth',
      read:   'auth',
      create: 'auth',
      update: ({ user, record }) => {
        if (!user) return false
        if (user.role === 'admin') return true
        return record?.[ownerField] === user.id
      },
      delete: ({ user, record }) => {
        if (!user) return false
        if (user.role === 'admin') return true
        return record?.[ownerField] === user.id
      },
      upload: 'auth',
    }
  },
} as const
