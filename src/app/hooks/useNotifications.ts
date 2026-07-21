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

// Public Supabase client (anon key is safe to expose client-side)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export function useNotifications(userId?: string) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [toast, setToast]                 = useState<Notification | null>(null)

  const addNotification = useCallback((order: any) => {
    // Only notify if this user is the seller or admin sees all
    const notif: Notification = {
      id:           crypto.randomUUID(),
      type:         'new_order',
      order_id:     order.id,
      order_number: order.order_number,
      amount:       Number(order.total_amount),
      buyer_name:   order.buyer_name || 'Someone',
      buyer_role:   order.buyer_role || 'reseller',
      seller_id:    order.seller_id,
      created_at:   order.created_at || new Date().toISOString(),
      read:         false,
    }
    setNotifications(prev => [notif, ...prev].slice(0, 50))
    setToast(notif)
    setTimeout(() => setToast(null), 5000)
  }, [])

  useEffect(() => {
    if (!userId) return

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
          const order = payload.new
          // Fetch buyer name since Supabase Realtime only gives raw row data
          try {
            const res  = await fetch(`/api/notifications/order-info?id=${order.id}`)
            const data = await res.json()
            addNotification({ ...order, ...data })
          } catch {
            addNotification(order)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId, addNotification])

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  return { notifications, unreadCount, toast, markAllRead }
}