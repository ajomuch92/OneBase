import { useSyncExternalStore } from 'hono/jsx'

// The browser only fires `popstate` for back/forward navigation — not for
// history.pushState()/replaceState() calls we make ourselves — so those two
// are patched once to also dispatch an event. That lets useSyncExternalStore
// treat window.location as the single source of truth for the whole app,
// instead of tracking the current route in a useState.
let patched = false

function patchHistory() {
  if (patched) return
  patched = true
  const rawPush    = history.pushState.bind(history)
  const rawReplace = history.replaceState.bind(history)
  history.pushState = (data: any, unused: string, url?: string | URL | null) => {
    rawPush(data, unused, url)
    window.dispatchEvent(new Event('pushState'))
  }
  history.replaceState = (data: any, unused: string, url?: string | URL | null) => {
    rawReplace(data, unused, url)
    window.dispatchEvent(new Event('replaceState'))
  }
}

function subscribe(callback: () => void): () => void {
  patchHistory()
  window.addEventListener('popstate', callback)
  window.addEventListener('pushState', callback)
  window.addEventListener('replaceState', callback)
  return () => {
    window.removeEventListener('popstate', callback)
    window.removeEventListener('pushState', callback)
    window.removeEventListener('replaceState', callback)
  }
}

function getSnapshot(): string {
  return window.location.pathname
}

/**
 * URL-synced router hook. No useState involved — the URL (via the History
 * API) is the single source of truth, and this just subscribes the
 * component tree to it.
 */
export function useLocation(): [string, (to: string) => void] {
  const pathname = useSyncExternalStore(subscribe, getSnapshot)
  const navigate = (to: string) => {
    if (to !== window.location.pathname) history.pushState(null, '', to)
  }
  return [pathname, navigate]
}
