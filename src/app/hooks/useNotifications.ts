'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface Notification {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  amount: number | null
  entity_type: string | null
  entity_id: string | null
  action_url: string | null
  read_at: string | null
  created_at: string
}

export function useNotifications(userId?: string, previewLimit = 5) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [toast, setToast] = useState<Notification | null>(null)
  const latestIdRef = useRef<string | null>(null)
  const initializedRef = useRef(false)

  const loadNotifications = useCallback(async () => {
    if (!userId) return
    try {
      const response = await fetch(`/api/notifications?page=1&pageSize=${previewLimit}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) return
      const data = await response.json()
      const nextNotifications = (data.notifications || []) as Notification[]
      const latest = nextNotifications[0]
      if (initializedRef.current && latest && latest.id !== latestIdRef.current && !latest.read_at) {
        setToast(latest)
        window.setTimeout(() => setToast(null), 5000)
      }
      latestIdRef.current = latest?.id || latestIdRef.current
      initializedRef.current = true
      setNotifications(nextNotifications)
      setUnreadCount(Number(data.unread || 0))
    } catch {}
  }, [userId, previewLimit])

  useEffect(() => {
    // Defer the initial fetch so state is updated from an external callback,
    // not synchronously while React is setting up this effect.
    const initialLoad = window.setTimeout(() => { void loadNotifications() }, 0)
    const timer = window.setInterval(loadNotifications, 15_000)
    const refreshOnFocus = () => loadNotifications()
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [loadNotifications])

  const markOneRead = useCallback(async (id: string) => {
    const target = notifications.find((item) => item.id === id)
    if (target?.read_at) return
    const readAt = new Date().toISOString()
    setNotifications((previous) =>
      previous.map((item) => item.id === id ? { ...item, read_at: readAt } : item)
    )
    setUnreadCount((count) => Math.max(0, count - 1))
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  }, [notifications])

  const markAllRead = useCallback(async () => {
    const readAt = new Date().toISOString()
    setNotifications((previous) => previous.map((item) => ({ ...item, read_at: item.read_at || readAt })))
    setUnreadCount(0)
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
  }, [])

  return {
    notifications,
    unreadCount,
    toast,
    markAllRead,
    markOneRead,
    mounted: true,
    refresh: loadNotifications,
  }
}
