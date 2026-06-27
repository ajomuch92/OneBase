import { Hono } from 'hono'
import { authService, extractAuth, requireAuth } from '../core/auth.ts'

export const authRouter = new Hono()

// POST /api/auth/register
authRouter.post('/register', async (c) => {
  const { email, password, role } = await c.req.json<{
    email:     string
    password:  string
    role?:     string
  }>()

  if (!email || !password) {
    return c.json({ error: 'email and password are required' }, 400)
  }

  const user = await authService.register(email, password, role)
  return c.json({ user }, 201)
})

// POST /api/auth/login
authRouter.post('/login', async (c) => {
  const { email, password } = await c.req.json<{
    email:    string
    password: string
  }>()

  if (!email || !password) {
    return c.json({ error: 'email and password are required' }, 400)
  }

  const tokens = await authService.login(email, password)
  return c.json(tokens)
})

// POST /api/auth/logout
authRouter.post('/logout', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAuth(auth)

  await authService.logout(auth.token)
  return c.json({ ok: true })
})

// GET /api/auth/me
authRouter.get('/me', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAuth(auth)
  return c.json({ user: auth.user })
})

// POST /api/auth/change-password
authRouter.post('/change-password', async (c) => {
  const auth = await extractAuth(c.req.raw)
  requireAuth(auth)

  const { currentPassword, newPassword } = await c.req.json<{
    currentPassword: string
    newPassword:     string
  }>()

  await authService.changePassword(auth.user.id, currentPassword, newPassword)
  return c.json({ ok: true })
})
