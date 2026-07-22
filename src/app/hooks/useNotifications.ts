// src/app/hooks/useNotifications.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

export interface Notification {
  id:           string
  type:         string
  order_id:     string
  order_number: string | null
  amount:       number
  buyer_name:   string
  buyer_role:   string
  seller_id:    string
  created_at:   string
  read:         boolean
}

// Lazy singleton — only created once, only in browser
let supabaseInstance: ReturnType<typeof createClient> | null = null

function getSupabase() {
  if (typeof window === 'undefined') return null
  if (supabaseInstance) return supabaseInstance
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  supabaseInstance = createClient(url, key)
  return supabaseInstance
}

export function useNotifications(userId?: string) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [mounted, setMounted]               = useState(false)
  const [toast, setToast] = useState<Notification | null>(null)

  // Load from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  // Load notifications when userId becomes available
  useEffect(() => {
    if (!userId) return
    try {
      const stored = localStorage.getItem(`notifications:${userId}`)
      if (stored) setNotifications(JSON.parse(stored))
    } catch {}
  }, [userId])

  const addNotification = useCallback((order: any) => {
    // Only notify if this user is the seller or admin sees all
    const notif: Notification = {
      id:           crypto.randomUUID(),
      type:         'new_order',
      order_id:     order.id,
      order_number: order.order_number,
      amount:       Number(order.total_amount),
      buyer_name:   order.buyer_name || 'New Order',
      buyer_role:   order.buyer_role || '',
      seller_id:    order.seller_id,
      created_at:   order.created_at || new Date().toISOString(),
      read:         false,
    }
    setNotifications(prev => {
      const updated = [notif, ...prev].slice(0, 50)
      // Persist to localStorage
      try { localStorage.setItem(`notifications:${userId}`, JSON.stringify(updated)) } catch {}
      return updated
    })
    setToast(notif)
    setTimeout(() => setToast(null), 5000)
  }, [])

  useEffect(() => {
    const supabase = getSupabase()
    if (!userId || !supabase) return

    // Listen for new orders where this user is the seller
    const channel = supabase
      .channel(`orders:${userId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'orders',
          filter: `seller_id=eq.${userId}`,
        },
        async (payload) => {
          const order = payload.new as any
          // Fetch buyer info — Supabase Realtime only gives raw DB columns (no joins)
          let retries = 3
          while (retries > 0) {
            try {
              const res = await fetch(`/api/notifications/order-info?id=${order.id}`, { credentials: 'include' })
              if (res.ok) {
                const data = await res.json()
                addNotification({
                  ...order,
                  buyer_name: data.buyer_name,
                  buyer_role: data.buyer_role,
                  seller_id:  data.seller_id,
                })
                return
              }
            } catch (e) {
              console.error('[NOTIFICATION] fetch attempt failed:', e)
            }
            retries--
            await new Promise(r => setTimeout(r, 500)) // wait 500ms before retry
          }
          // Final fallback with raw data
          addNotification(order)
        }
      )
      .subscribe()

    return () => { getSupabase()?.removeChannel(channel) }
  }, [userId, addNotification])

  const markOneRead = useCallback((id: string) => {
    setNotifications(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, read: true } : n)
      try { localStorage.setItem(`notifications:${userId}`, JSON.stringify(updated)) } catch {}
      return updated
    })
  }, [userId])

  const markAllRead = useCallback(() => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }))
      try { localStorage.setItem(`notifications:${userId}`, JSON.stringify(updated)) } catch {}
      return updated
    })
  }, [userId])

  const unreadCount = notifications.filter(n => !n.read).length

  return { notifications, unreadCount, toast, markAllRead, markOneRead, mounted }
}