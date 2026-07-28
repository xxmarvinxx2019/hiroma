'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Notification } from '@/app/hooks/useNotifications'

const PAGE_SIZE = 20

function iconFor(type: string) {
  if (type.includes('referral')) return '👥'
  if (type.includes('binary') || type === 'sponsor_point') return '🔗'
  if (type.startsWith('payout')) return '💸'
  if (type.startsWith('order')) return '🛒'
  if (type.startsWith('payment_method')) return '💳'
  if (type.startsWith('security')) return '🛡️'
  return '🔔'
}

export default function ResellerNotificationsPage() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const response = await fetch(
      `/api/notifications?page=${page}&pageSize=${PAGE_SIZE}&unread=${filter === 'unread'}`,
      { cache: 'no-store' }
    )
    const data = await response.json()
    if (response.ok) {
      setNotifications(data.notifications || [])
      setUnread(Number(data.unread || 0))
      setTotalPages(Number(data.meta?.totalPages || 1))
    }
    setLoading(false)
  }, [page, filter])

  useEffect(() => { load() }, [load])

  const openNotification = async (notification: Notification) => {
    if (!notification.read_at) {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: notification.id }),
      })
    }
    if (notification.action_url) router.push(notification.action_url)
    else load()
  }

  const markAllRead = async () => {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    load()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">Account activity</p>
          <h1 className="mt-1 text-xl font-semibold text-[#0D1B3E]">Notifications</h1>
          <p className="mt-1 text-xs text-gray-400">
            Commissions, payouts, orders, and important account updates.
          </p>
        </div>
        {unread > 0 && (
          <button onClick={markAllRead}
            className="rounded-xl border border-[#C9A84C]/40 bg-white px-4 py-2 text-xs font-semibold text-[#9a6f1e]">
            Mark all as read
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#0D1B3E]/8 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-[#0D1B3E]/8 px-4 py-3">
          <button onClick={() => { setFilter('all'); setPage(1) }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === 'all' ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-500'}`}>
            All
          </button>
          <button onClick={() => { setFilter('unread'); setPage(1) }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === 'unread' ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-500'}`}>
            Unread {unread > 0 ? `(${unread})` : ''}
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-3xl">🔔</p>
            <p className="mt-2 text-sm font-medium text-[#0D1B3E]">No notifications found</p>
            <p className="mt-1 text-xs text-gray-400">New account activity will appear here.</p>
          </div>
        ) : notifications.map((notification) => {
          const isUnread = !notification.read_at
          return (
            <button key={notification.id} onClick={() => openNotification(notification)}
              className={`flex w-full items-start gap-4 border-b border-[#0D1B3E]/5 px-5 py-4 text-left transition-colors ${
                isUnread ? 'border-l-4 border-l-[#C9A84C] bg-[#fffbeb]' : 'hover:bg-[#f8f9fc]'
              }`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ${
                isUnread ? 'bg-[#C9A84C]/15' : 'bg-[#F0F2F8]'
              }`}>{iconFor(notification.type)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`text-sm ${isUnread ? 'font-bold text-[#0D1B3E]' : 'font-medium text-gray-600'}`}>
                    {notification.title}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {new Date(notification.created_at).toLocaleString('en-PH')}
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-gray-500">{notification.message}</span>
              </span>
              {isUnread && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[#C9A84C]" />}
            </button>
          )
        })}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3">
            <button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="rounded-lg bg-[#F0F2F8] px-3 py-1.5 text-xs disabled:opacity-40">Previous</button>
            <p className="text-xs text-gray-400">Page {page} of {totalPages}</p>
            <button disabled={page === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              className="rounded-lg bg-[#F0F2F8] px-3 py-1.5 text-xs disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
