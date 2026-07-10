import { Hono } from 'hono'
import { authService, extractAuth, requireAuth } from '../core/auth.ts'
import { rateLimiter } from '../core/rateLimit.ts'

export const authRouter = new Hono()

// Credential-guessing endpoints get a much tighter budget than the rest of
// the API — this is what actually stops brute-force login/signup attempts.
const authLimiter = rateLimiter({
  windowMs: Number(process.env.ONEBASE_AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000),
  max:      Number(process.env.ONEBASE_AUTH_RATE_LIMIT_MAX ?? 10),
})

authRouter.post('/register', authLimiter, async (c) => {
  const { email, password, role } = await c.req.json<any>()
  if (!email || !password) return c.json({ error: 'email and password required' }, 400)
  const user = await authService.register(email, password, role)
  return c.json({ user }, 201)
})

authRouter.post('/login', authLimiter, async (c) => {
  const { email, password } = await c.req.json<any>()
  if (!email || !password) return c.json({ error: 'email and password required' }, 400)
  const tokens = await authService.login(email, password)
  return c.json(tokens)
})

authRouter.post('/logout', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAuth(auth)
  await authService.logout(auth.token)
  return c.json({ ok: true })
})

authRouter.get('/me', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAuth(auth)
  return c.json({ user: auth.user })
})
