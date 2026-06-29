import type { AuthContext } from './auth.ts'

type EventType = 'create' | 'update' | 'delete'

interface Subscriber {
  socket: WebSocket; userId?: string; collections: Set<string>
}

class RealtimeService {
  private subs = new Map<string, Subscriber>()

  handleUpgrade(req: Request, auth: AuthContext | null): Response {
    const url         = new URL(req.url)
    const collections = url.searchParams.get('collections')?.split(',').filter(Boolean) ?? []
    const { socket, response } = Bun.upgradeWebSocket(req, { data: {} }) as any
    const id = crypto.randomUUID()

    socket.addEventListener('open', () => {
      this.subs.set(id, { socket, userId: auth?.user.id, collections: new Set(collections) })
      socket.send(JSON.stringify({ type: 'connected', id }))
    })
    socket.addEventListener('message', (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data)
        const sub = this.subs.get(id)
        if (!sub) return
        if (msg.type === 'subscribe')   msg.collections?.forEach((c: string) => sub.collections.add(c))
        if (msg.type === 'unsubscribe') msg.collections?.forEach((c: string) => sub.collections.delete(c))
      } catch {}
    })
    socket.addEventListener('close', () => this.subs.delete(id))
    return response
  }

  broadcast(collection: string, event: EventType, record: unknown) {
    const msg = JSON.stringify({ collection, event, record })
    for (const sub of this.subs.values()) {
      if (sub.collections.size === 0 || sub.collections.has(collection)) {
        try { if (sub.socket.readyState === WebSocket.OPEN) sub.socket.send(msg) } catch {}
      }
    }
  }

  get connectionCount() { return this.subs.size }
}

export const realtimeService = new RealtimeService()
