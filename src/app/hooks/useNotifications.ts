// src/app/hooks/useNotifications.ts
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface Notification {
  id:           string
  type:         string
  order_id:     string
  order_number: string | null
  amount:       number
  buyer_name:   string
  buyer_role:   string
  created_at:   string
  read:         boolean
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [toast, setToast]                 = useState<Notification | null>(null)
  const esRef                             = useRef<EventSource | null>(null)

  const addNotification = useCallback((data: any) => {
    const notif: Notification = {
      id:           crypto.randomUUID(),
      type:         data.type,
      order_id:     data.order_id,
      order_number: data.order_number,
      amount:       data.amount,
      buyer_name:   data.buyer_name,
      buyer_role:   data.buyer_role,
      created_at:   data.created_at || new Date().toISOString(),
      read:         false,
    }
    setNotifications(prev => [notif, ...prev].slice(0, 50))
    setToast(notif)
    setTimeout(() => setToast(null), 5000)
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/notifications/stream')
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'new_order') addNotification(data)
      } catch {}
    }

    es.onerror = () => {
      es.close()
      // Reconnect after 3 seconds
      setTimeout(() => {
        esRef.current = new EventSource('/api/notifications/stream')
      }, 3000)
    }

    return () => { es.close() }
  }, [addNotification])

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  return { notifications, unreadCount, toast, markAllRead }
}