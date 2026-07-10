import { getDB } from './db.ts'
import { sign, verify } from 'jsonwebtoken'
import { hash, compare } from 'bcryptjs'

const JWT_SECRET     = process.env.ONEBASE_JWT_SECRET ?? 'change-me-in-production'
const JWT_EXPIRES_IN = '7d'
const BCRYPT_ROUNDS  = 12

export interface AuthUser {
  id: string; email: string; role: string; verified: boolean
}

export interface AuthTokens {
  token: string; expiresAt: string; user: AuthUser
}

export const authService = {
  async register(email: string, password: string, role = 'user'): Promise<AuthUser> {
    const db = getDB()
    if (await db.get('SELECT id FROM _ob_users WHERE email = ?', [email.toLowerCase()])) {
      throw new Error('Email already in use')
    }
    if (password.length < 8) throw new Error('Password must be at least 8 characters')
    const id           = crypto.randomUUID()
    const passwordHash = await hash(password, BCRYPT_ROUNDS)
    await db.run(
      'INSERT INTO _ob_users (id, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [id, email.toLowerCase(), passwordHash, role]
    )
    return { id, email: email.toLowerCase(), role, verified: false }
  },

  async login(email: string, password: string): Promise<AuthTokens> {
    const db   = getDB()
    const user = await db.get<any>('SELECT * FROM _ob_users WHERE email = ?', [email.toLowerCase()])
    if (!user) throw new Error('Invalid credentials')
    if (!await compare(password, user.password_hash)) throw new Error('Invalid credentials')
    return this.createTokens(user)
  },

  async createTokens(user: any): Promise<AuthTokens> {
    const db        = getDB()
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()
    const token     = sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
    await db.run('INSERT INTO _ob_sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
      [crypto.randomUUID(), user.id, token, expiresAt])
    return { token, expiresAt, user: { id: user.id, email: user.email, role: user.role, verified: !!user.verified } }
  },

  async verifyToken(token: string): Promise<AuthUser> {
    const db = getDB()
    let payload: any
    try { payload = verify(token, JWT_SECRET) } catch { throw new Error('Invalid or expired token') }
    const session = await db.get('SELECT id FROM _ob_sessions WHERE token = ? AND expires_at > ?',
      [token, new Date().toISOString()])
    if (!session) throw new Error('Session expired or revoked')
    const user = await db.get<any>('SELECT * FROM _ob_users WHERE id = ?', [payload.sub])
    if (!user) throw new Error('User not found')
    return { id: user.id, email: user.email, role: user.role, verified: !!user.verified }
  },

  async logout(token: string) {
    await getDB().run('DELETE FROM _ob_sessions WHERE token = ?', [token])
  },

  async userCount(): Promise<number> {
    const row = await getDB().get<{ c: number }>('SELECT COUNT(*) as c FROM _ob_users')
    return row?.c ?? 0
  },
}

export type AuthContext = { user: AuthUser; token: string }

export async function extractAuth(req: Request): Promise<AuthContext | null> {
  const h = req.headers.get('Authorization')
  if (!h?.startsWith('Bearer ')) return null
  try { return { user: await authService.verifyToken(h.slice(7)), token: h.slice(7) } }
  catch { return null }
}

export function requireAuth(auth: AuthContext | null): asserts auth is AuthContext {
  if (!auth) throw new Error('Unauthorized')
}

export function requireAdmin(auth: AuthContext | null): asserts auth is AuthContext {
  requireAuth(auth)
  if (auth.user.role !== 'admin') throw new Error('Forbidden')
}
