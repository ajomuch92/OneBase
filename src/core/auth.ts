import { getDB, usersTable, sessionsTable } from './db.ts'
import { eq, and, gt } from 'drizzle-orm'
import { sign, verify } from 'jsonwebtoken'
import { hash, compare } from 'bcryptjs'

// ─── Config ──────────────────────────────────────────────────────────────────

const JWT_SECRET     = process.env.JUST_TS_JWT_SECRET ?? 'change-me-in-production'
const JWT_EXPIRES_IN = process.env.JUST_TS_JWT_EXPIRES ?? '7d'
const BCRYPT_ROUNDS  = 12

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:        string
  email:     string
  role:      string
  verified:  boolean
}

export interface JWTPayload {
  sub:   string
  email: string
  role:  string
  iat:   number
  exp:   number
}

export interface AuthTokens {
  token:     string
  expiresAt: string
  user:      AuthUser
}

// ─── Auth service ─────────────────────────────────────────────────────────────

export const authService = {

  // ── Register ──────────────────────────────────────────────────────────────

  async register(email: string, password: string, role = 'user'): Promise<AuthUser> {
    const db = getDB()

    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .get()

    if (existing) throw new Error('Email already in use')

    if (password.length < 8) throw new Error('Password must be at least 8 characters')

    const passwordHash = await hash(password, BCRYPT_ROUNDS)
    const id = crypto.randomUUID()

    await db.insert(usersTable).values({
      id,
      email:        email.toLowerCase(),
      passwordHash,
      role,
      verified:     false,
    })

    return { id, email: email.toLowerCase(), role, verified: false }
  },

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<AuthTokens> {
    const db = getDB()

    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .get()

    if (!user) throw new Error('Invalid credentials')

    const valid = await compare(password, user.passwordHash)
    if (!valid) throw new Error('Invalid credentials')

    return this.createTokens(user)
  },

  // ── Create tokens ─────────────────────────────────────────────────────────

  async createTokens(user: typeof usersTable.$inferSelect): Promise<AuthTokens> {
    const db = getDB()

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const token = sign(
      { sub: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    )

    await db.insert(sessionsTable).values({
      id:        crypto.randomUUID(),
      userId:    user.id,
      token,
      expiresAt: expiresAt.toISOString(),
    })

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id:       user.id,
        email:    user.email,
        role:     user.role,
        verified: user.verified,
      },
    }
  },

  // ── Verify token ──────────────────────────────────────────────────────────

  async verifyToken(token: string): Promise<AuthUser> {
    const db = getDB()

    let payload: JWTPayload
    try {
      payload = verify(token, JWT_SECRET) as JWTPayload
    } catch {
      throw new Error('Invalid or expired token')
    }

    // Check session still exists in DB
    const session = await db
      .select()
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.token, token),
          gt(sessionsTable.expiresAt, new Date().toISOString()),
        ),
      )
      .get()

    if (!session) throw new Error('Session expired or revoked')

    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, payload.sub))
      .get()

    if (!user) throw new Error('User not found')

    return {
      id:       user.id,
      email:    user.email,
      role:     user.role,
      verified: user.verified,
    }
  },

  // ── Logout ────────────────────────────────────────────────────────────────

  async logout(token: string): Promise<void> {
    const db = getDB()
    await db.delete(sessionsTable).where(eq(sessionsTable.token, token))
  },

  // ── Logout all sessions ───────────────────────────────────────────────────

  async logoutAll(userId: string): Promise<void> {
    const db = getDB()
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId))
  },

  // ── Change password ───────────────────────────────────────────────────────

  async changePassword(userId: string, currentPwd: string, newPwd: string): Promise<void> {
    const db = getDB()

    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .get()

    if (!user) throw new Error('User not found')

    const valid = await compare(currentPwd, user.passwordHash)
    if (!valid) throw new Error('Current password is incorrect')

    if (newPwd.length < 8) throw new Error('New password must be at least 8 characters')

    const passwordHash = await hash(newPwd, BCRYPT_ROUNDS)
    await db
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where(eq(usersTable.id, userId))

    // Revoke all sessions after password change
    await this.logoutAll(userId)
  },
}

// ─── Middleware helper (used in router.ts) ────────────────────────────────────

export type AuthContext = {
  user:  AuthUser
  token: string
}

export async function extractAuth(req: Request): Promise<AuthContext | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)

  try {
    const user = await authService.verifyToken(token)
    return { user, token }
  } catch {
    return null
  }
}

export function requireAuth(auth: AuthContext | null): asserts auth is AuthContext {
  if (!auth) throw new Error('Unauthorized')
}

export function requireRole(auth: AuthContext | null, role: string): asserts auth is AuthContext {
  requireAuth(auth)
  if (auth.user.role !== role && auth.user.role !== 'admin') {
    throw new Error('Forbidden')
  }
}
