import type { AuthContext } from './auth.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

type EventType = 'create' | 'update' | 'delete'

interface RealtimeMessage {
  collection: string
  event:      EventType
  record:     unknown
}

interface Subscriber {
  socket:      WebSocket
  userId?:     string
  collections: Set<string>   // empty = subscribe to all
}

// ─── Realtime service ─────────────────────────────────────────────────────────

class RealtimeService {
  private subscribers = new Map<string, Subscriber>()

  // ── WebSocket upgrade ──────────────────────────────────────────────────

  handleUpgrade(req: Request, auth: AuthContext | null): Response {
    const url = new URL(req.url)
    const collections = url.searchParams.get('collections')?.split(',').filter(Boolean) ?? []

    const { socket, response } = Bun.upgradeWebSocket(req, {
      data: {
        userId:      auth?.user.id,
        collections: new Set(collections),
      },
    }) as { socket: WebSocket; response: Response }

    const id = crypto.randomUUID()

    socket.addEventListener('open', () => {
      this.subscribers.set(id, {
        socket,
        userId:      auth?.user.id,
        collections: new Set(collections),
      })
      socket.send(JSON.stringify({ type: 'connected', id }))
    })

    socket.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data as string)
        if (msg.type === 'subscribe' && Array.isArray(msg.collections)) {
          const sub = this.subscribers.get(id)
          if (sub) {
            msg.collections.forEach((c: string) => sub.collections.add(c))
          }
        }
        if (msg.type === 'unsubscribe' && Array.isArray(msg.collections)) {
          const sub = this.subscribers.get(id)
          if (sub) {
            msg.collections.forEach((c: string) => sub.collections.delete(c))
          }
        }
      } catch {
        // ignore malformed messages
      }
    })

    socket.addEventListener('close', () => {
      this.subscribers.delete(id)
    })

    return response
  }

  // ── Broadcast to subscribers of a collection ───────────────────────────

  broadcast(collection: string, event: EventType, record: unknown) {
    const message = JSON.stringify({ collection, event, record } satisfies RealtimeMessage)

    for (const sub of this.subscribers.values()) {
      // Send if subscribed to all OR subscribed to this specific collection
      if (sub.collections.size === 0 || sub.collections.has(collection)) {
        try {
          if (sub.socket.readyState === WebSocket.OPEN) {
            sub.socket.send(message)
          }
        } catch {
          // socket might have closed between the check and send
        }
      }
    }
  }

  get connectionCount() {
    return this.subscribers.size
  }
}

export const realtimeService = new RealtimeService()
