import type { Context, MiddlewareHandler } from 'hono'

export interface RateLimitOptions {
  windowMs: number
  max:      number
  keyFn?:   (c: Context) => string
}

interface Bucket { count: number; resetAt: number }

function defaultKey(c: Context): string {
  // Trust a proxy-set header first (typical deployment behind nginx/Cloudflare/etc.)
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  const real = c.req.header('x-real-ip')
  if (real) return real
  // Bun.serve() hands the live server instance to Hono via the fetch() env
  // argument (see src/cli/index.ts), which surfaces here as c.env.
  const server = (c.env as any)?.server
  const ip = server?.requestIP?.(c.req.raw)?.address
  return ip ?? 'unknown'
}

/**
 * Simple fixed-window, in-memory rate limiter. Good enough for a
 * single-process binary — if OneBase is ever run as multiple replicas
 * behind a load balancer, put a shared limiter (e.g. Redis-backed) in
 * front instead.
 */
export function rateLimiter(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>()
  const keyFn   = opts.keyFn ?? defaultKey

  // Periodic sweep so long-running processes don't accumulate stale buckets
  // for IPs/keys that stop sending requests.
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }
  }, opts.windowMs)
  sweep.unref?.()

  return async (c, next) => {
    if (process.env.ONEBASE_RATE_LIMIT_DISABLED === 'true') return next()

    const key = keyFn(c)
    const now = Date.now()
    let bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs }
      buckets.set(key, bucket)
    }

    bucket.count++

    const remaining = Math.max(0, opts.max - bucket.count)
    const resetSecs = Math.ceil((bucket.resetAt - now) / 1000)
    c.header('RateLimit-Limit', String(opts.max))
    c.header('RateLimit-Remaining', String(remaining))
    c.header('RateLimit-Reset', String(resetSecs))

    if (bucket.count > opts.max) {
      c.header('Retry-After', String(resetSecs))
      return c.json({ error: 'Too many requests, please try again later' }, 429)
    }

    await next()
  }
}
