// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:       string
  email:    string
  role:     string
  verified: boolean
}

export interface CollectionStat {
  name:  string
  count: number
}

export interface StatsResponse {
  collections:          CollectionStat[]
  realtimeConnections:  number
}

export interface FieldDefinition {
  type:       string
  required?:  boolean
  unique?:    boolean
  default?:   unknown
  collection?: string
}

export interface CollectionDef {
  name:   string
  fields: Record<string, FieldDefinition>
  count:  number
}

export interface ListResult<T> {
  items:  T[]
  total:  number
  limit:  number
  offset: number
}

// ─── Client ───────────────────────────────────────────────────────────────────

class AdminAPI {
  private token: string | null = localStorage.getItem('just_ts_token')

  setToken(t: string | null) {
    this.token = t
    if (t) localStorage.setItem('just_ts_token', t)
    else    localStorage.removeItem('just_ts_token')
  }

  getToken() { return this.token }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error((err as { error: string }).error ?? res.statusText)
    }
    return res.json() as Promise<T>
  }

  // Auth
  async login(email: string, password: string) {
    const res = await this.req<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ email, password }),
    })
    this.setToken(res.token)
    return res
  }

  async logout() {
    await this.req('/api/auth/logout', { method: 'POST' }).catch(() => {})
    this.setToken(null)
  }

  async me() {
    return this.req<{ user: AuthUser }>('/api/auth/me')
  }

  // Admin
  async stats()       { return this.req<StatsResponse>('/admin/api/stats') }
  async collections() { return this.req<CollectionDef[]>('/admin/api/collections') }

  async records(collection: string, limit = 20, offset = 0) {
    return this.req<ListResult<Record<string, unknown>>>(
      `/admin/api/collections/${collection}/records?limit=${limit}&offset=${offset}`
    )
  }
}

export const api = new AdminAPI()
