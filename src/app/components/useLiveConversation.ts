'use client'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

// Sequential requests avoid overlapping polls; resume immediately on reconnect.
export function useLiveConversation<T>(url: string, onUpdate: (data: T) => void) {
  const update = useEffectEvent(onUpdate)
  const [reconnecting, setReconnecting] = useState(false)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let controller: AbortController | undefined
    let busy = false
    async function refresh() {
      if (stopped || busy) return
      clearTimeout(timer)
      if (document.hidden || !navigator.onLine) return
      busy = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 10000)
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('Conversation unavailable')
        const data = await response.json()
        if (!stopped) { update(data); setReconnecting(false) }
      } catch {
        if (!stopped) setReconnecting(true)
      } finally {
        clearTimeout(timeout)
        busy = false
        if (!stopped) timer = setTimeout(refresh, 1000)
      }
    }
    void refresh()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [url])
  return reconnecting
}

export function useSupportTyping(url: string) {
  const lastSent = useRef(0)
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function notify(typing: boolean) {
    void fetch(url, { method: 'PATCH', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ typing }) }).catch(() => {})
  }
  useEffect(() => () => {
    clearTimeout(idle.current)
    void fetch(url, { method: 'PATCH', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ typing: false }) }).catch(() => {})
  }, [url])
  return (value: string) => {
    clearTimeout(idle.current)
    if (!value.trim()) { notify(false); lastSent.current = 0; return }
    if (Date.now() - lastSent.current > 2000) { notify(true); lastSent.current = Date.now() }
    idle.current = setTimeout(() => { notify(false); lastSent.current = 0 }, 3000)
  }
}

export function useConversationScroll(lastMessageId: string | undefined) {
  const container = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  useEffect(() => {
    if (container.current && nearBottom.current) container.current.scrollTop = container.current.scrollHeight
  }, [lastMessageId])
  return { ref: container, onScroll: () => {
    const element = container.current
    if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
  } }
}
