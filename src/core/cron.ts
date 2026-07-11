// Built on Bun's native in-process cron (https://bun.com/docs/runtime/cron) —
// `Bun.cron` is a global, not an import, so this needs no npm dependency at
// all and sidesteps `bun build --compile`'s known trouble embedding
// dynamically-reached npm packages (see git history for the saga we went
// through with the `croner` package before switching to this).
import { getDB } from './db.ts'

export interface CronJobContext {
  store: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    del(key: string): Promise<void>
  }
}

export interface CronJobDefinition {
  name: string
  /**
   * Standard 5-field cron expression, e.g. "0 3 * * *" (every day at
   * 03:00), or a nickname like "@daily". Bun's in-process cron always
   * interprets this in UTC — there's no per-job timezone override.
   */
  schedule: string
  run: (ctx: CronJobContext) => Promise<void> | void
}

interface LiveJob {
  bunJob:      Bun.CronJob
  previousRun: Date | null
  isRunning:   boolean
}

const registry = new Map<string, CronJobDefinition>()
const liveJobs = new Map<string, LiveJob>()

export function defineCronJob(def: CronJobDefinition): CronJobDefinition {
  if (registry.has(def.name)) throw new Error(`Cron job "${def.name}" is already defined`)
  registry.set(def.name, def)
  return def
}

export function getAllCronJobDefs() { return Array.from(registry.values()) }

// Namespaced under the same `_ob_plugin_store` KV table plugins already use
// — cheap to share, and the `cron:` prefix keeps a job's key from ever
// colliding with a plugin's key of the same name.
const jobContext: CronJobContext = {
  store: {
    async get(key) {
      const row = await getDB().get<{ value: string }>('SELECT value FROM _ob_plugin_store WHERE store_key = ?', [`cron:${key}`])
      return row?.value ?? null
    },
    async set(key, value) {
      await getDB().upsertKV('_ob_plugin_store', 'store_key', 'value', `cron:${key}`, value)
    },
    async del(key) {
      await getDB().run('DELETE FROM _ob_plugin_store WHERE store_key = ?', [`cron:${key}`])
    },
  },
}

async function runJob(name: string, job: CronJobDefinition, live: LiveJob) {
  live.isRunning = true
  try {
    console.log(`[cron] running "${name}"`)
    await job.run(jobContext)
  } catch (err) {
    // Bun.cron's own error handling matches setTimeout semantics (an
    // uncaught rejection here would otherwise crash the process) — catch
    // and log instead, and keep the job scheduled for its next fire.
    console.error(`[cron] "${name}" failed:`, err)
  } finally {
    live.isRunning   = false
    live.previousRun = new Date()
  }
}

/** Starts every registered job. Safe to call more than once — already-started jobs are skipped. */
export function startCronJobs() {
  for (const [name, job] of registry) {
    if (liveJobs.has(name)) continue
    const live: LiveJob = { bunJob: undefined as any, previousRun: null, isRunning: false }
    // Bun.cron() itself already guarantees no-overlap (the next fire isn't
    // scheduled until the handler settles), so no extra "protect" needed.
    live.bunJob = Bun.cron(job.schedule, () => runJob(name, job, live))
    liveJobs.set(name, live)
  }
}

export function stopCronJobs() {
  for (const live of liveJobs.values()) live.bunJob.stop()
  liveJobs.clear()
}

export interface CronJobStatus {
  name:        string
  schedule:    string
  nextRun:     string | null
  previousRun: string | null
  isRunning:   boolean
}

export function getCronStatus(): CronJobStatus[] {
  return Array.from(liveJobs.entries()).map(([name, live]) => {
    const schedule = registry.get(name)?.schedule ?? ''
    return {
      name,
      schedule,
      nextRun:     Bun.cron.parse(schedule)?.toISOString() ?? null,
      previousRun: live.previousRun?.toISOString() ?? null,
      isRunning:   live.isRunning,
    }
  })
}

/** Runs a registered job immediately, outside its normal schedule (e.g. an admin "Run now" button). */
export async function triggerCronJob(name: string): Promise<void> {
  const job  = registry.get(name)
  const live = liveJobs.get(name)
  if (!job || !live) throw new Error(`Cron job "${name}" not found`)
  await runJob(name, job, live)
}
