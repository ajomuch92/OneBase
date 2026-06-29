import type { AuthContext } from './auth.ts'

type EventType = 'create' | 'update' | 'delete'

interface Subscriber {
  socket:      any
  userId?:     string
  collections: Set<string>
}

class RealtimeService {
  private subs = new Map<string, Subscriber>()

  // Called from Bun.serve websocket.open handler
  onOpen(ws: any) {
    const { id, userId, collections } = ws.data as {
      id: string; userId?: string; collections: string[]
    }
    this.subs.set(id, { socket: ws, userId, collections: new Set(collections) })
    ws.send(JSON.stringify({ type: 'connected', id }))
  }

  // Called from Bun.serve websocket.message handler
  onMessage(ws: any, message: string) {
    const { id } = ws.data as { id: string }
    try {
      const msg = JSON.parse(message)
      const sub = this.subs.get(id)
      if (!sub) return
      if (msg.type === 'subscribe'   && Array.isArray(msg.collections))
        msg.collections.forEach((c: string) => sub.collections.add(c))
      if (msg.type === 'unsubscribe' && Array.isArray(msg.collections))
        msg.collections.forEach((c: string) => sub.collections.delete(c))
    } catch {}
  }

  // Called from Bun.serve websocket.close handler
  onClose(ws: any) {
    const { id } = ws.data as { id: string }
    this.subs.delete(id)
  }

  // Called from the fetch handler — delegates upgrade to Bun's server instance
  // server is passed in from the router so we can call server.upgrade()
  upgrade(req: Request, server: any, auth: AuthContext | null): boolean {
    const url         = new URL(req.url)
    const collections = url.searchParams.get('collections')?.split(',').filter(Boolean) ?? []
    const id          = crypto.randomUUID()

    return server.upgrade(req, {
      data: { id, userId: auth?.user.id ?? null, collections },
    })
  }

  broadcast(collection: string, event: EventType, record: unknown) {
    const msg = JSON.stringify({ collection, event, record })
    for (const sub of this.subs.values()) {
      if (sub.collections.size === 0 || sub.collections.has(collection)) {
        try { sub.socket.send(msg) } catch {}
      }
    }
  }

  get connectionCount() { return this.subs.size }
}

export const realtimeService = new RealtimeService()
