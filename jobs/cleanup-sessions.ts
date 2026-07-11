import { defineCronJob } from '../src/index.ts'
import { getDB } from '../src/core/db.ts'

// Sessions are only ever removed on explicit logout (see authService.logout
// in src/core/auth.ts) — an expired JWT is already rejected by
// verifyToken() regardless of whether its _ob_sessions row still exists, so
// nothing else prunes that table. Left alone it grows forever; this just
// sweeps out rows that are already expired.
defineCronJob({
  name:     'cleanup-expired-sessions',
  schedule: '0 3 * * *', // every day at 03:00
  run: async () => {
    const db  = getDB()
    const now = new Date().toISOString()
    const { c: expired } = (await db.get<{ c: number }>(
      'SELECT COUNT(*) as c FROM _ob_sessions WHERE expires_at <= ?', [now],
    )) ?? { c: 0 }
    if (expired === 0) return
    await db.run('DELETE FROM _ob_sessions WHERE expires_at <= ?', [now])
    console.log(`[cron] cleanup-expired-sessions: removed ${expired} expired session(s)`)
  },
})
