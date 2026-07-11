import type { AuthUser } from './auth.ts'
import type { CollectionRecord } from './collections.ts'

export type Action = 'list' | 'read' | 'create' | 'update' | 'delete' | 'upload'
export type PermissionRule = 'public' | 'auth' | 'admin' | string[] | RuleFn
export type RuleFn = (ctx: RuleContext) => boolean | Promise<boolean>

export interface RuleContext {
  user: AuthUser | null; record?: CollectionRecord
  data?: Record<string, unknown>; action: Action
}

export type CollectionPermissions = Partial<Record<Action, PermissionRule>>

class PermissionEngine {
  private rules = new Map<string, CollectionPermissions>()

  register(collection: string, perms: CollectionPermissions) {
    this.rules.set(collection, perms)
  }

  hasRule(collection: string): boolean {
    return this.rules.has(collection)
  }

  // `fallback` lets a caller pick a different implicit default than 'auth'
  // for collections nobody has registered rules for — used for the built-in
  // `users` collection, whose `read` action defaults to 'public' (it's
  // already restricted to a handful of non-sensitive columns) so relation
  // `expand` and lookups work out of the box for anonymous requests too,
  // while remaining fully overridable via `definePermissions('users', ...)`.
  async assert(collection: string, action: Action, user: AuthUser | null,
    record?: CollectionRecord, data?: Record<string, unknown>, fallback: PermissionRule = 'auth') {
    const rule = this.rules.get(collection)?.[action] ?? fallback
    const allowed = await this.evaluate(rule, { user, record, data, action })
    if (!allowed) throw new Error(user ? 'Forbidden' : 'Unauthorized')
  }

  private async evaluate(rule: PermissionRule, ctx: RuleContext): Promise<boolean> {
    if (!ctx.user) return rule === 'public'
    if (rule === 'public' || rule === 'auth') return true
    if (rule === 'admin') return ctx.user.role === 'admin'
    if (Array.isArray(rule)) return rule.includes(ctx.user.role)
    if (typeof rule === 'function') return rule(ctx)
    return false
  }
}

export const permissionEngine = new PermissionEngine()

export function definePermissions(collection: string, perms: CollectionPermissions) {
  permissionEngine.register(collection, perms)
}

export const PRESETS = {
  PUBLIC:      { list: 'public', read: 'public', create: 'public', update: 'public', delete: 'public' } as CollectionPermissions,
  PUBLIC_READ: { list: 'public', read: 'public', create: 'auth',   update: 'auth',   delete: 'auth'   } as CollectionPermissions,
  ADMIN_ONLY:  { list: 'admin',  read: 'admin',  create: 'admin',  update: 'admin',  delete: 'admin'  } as CollectionPermissions,
  PRIVATE:     { list: 'auth',   read: 'auth',   create: 'auth',   update: 'auth',   delete: 'auth'   } as CollectionPermissions,
  OWNER(ownerField = 'authorId'): CollectionPermissions {
    const ownerOrAdmin = ({ user, record }: RuleContext) =>
      !!user && (user.role === 'admin' || record?.[ownerField] === user.id)
    return { list: 'auth', read: 'auth', create: 'auth', update: ownerOrAdmin, delete: ownerOrAdmin }
  },
}
