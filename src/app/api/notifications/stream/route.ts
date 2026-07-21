import { NextRequest } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'

export const dynamic = 'force-dynamic'

// Use globalThis to share clients across module instances in the same process
declare global {
  var sseClients: Map<string, Set<ReadableStreamDefaultController>> | undefined
}

if (!globalThis.sseClients) {
  globalThis.sseClients = new Map()
}

const clients = globalThis.sseClients

export function broadcastToUser(userId: string, data: object) {
  const userClients = clients.get(userId)
  if (!userClients || userClients.size === 0) return
  const msg = `data: ${JSON.stringify(data)}\n\n`
  const encoded = new TextEncoder().encode(msg)
  for (const ctrl of userClients) {
    try { ctrl.enqueue(encoded) } catch { userClients.delete(ctrl) }
  }
}

export function broadcastToAll(data: object) {
  const msg = `data: ${JSON.stringify(data)}\n\n`
  const encoded = new TextEncoder().encode(msg)
  for (const [, userClients] of clients) {
    for (const ctrl of userClients) {
      try { ctrl.enqueue(encoded) } catch { userClients.delete(ctrl) }
    }
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  let controller: ReadableStreamDefaultController

  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl

      if (!clients.has(user.id)) clients.set(user.id, new Set())
      clients.get(user.id)!.add(ctrl)

      // Send connection confirmation
      const ping = `data: ${JSON.stringify({ type: 'connected', userId: user.id })}\n\n`
      ctrl.enqueue(new TextEncoder().encode(ping))

      // Keep-alive ping every 30s to prevent timeout
      const keepAlive = setInterval(() => {
        try {
          ctrl.enqueue(new TextEncoder().encode(': ping\n\n'))
        } catch {
          clearInterval(keepAlive)
        }
      }, 30000)

      // Store cleanup reference
      ;(ctrl as any)._keepAlive = keepAlive
    },
    cancel() {
      const userClients = clients.get(user.id)
      if (userClients) {
        userClients.delete(controller)
        if (userClients.size === 0) clients.delete(user.id)
      }
      clearInterval((controller as any)._keepAlive)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}