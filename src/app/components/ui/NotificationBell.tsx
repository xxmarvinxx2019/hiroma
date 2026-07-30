'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useNotifications, Notification } from '@/app/hooks/useNotifications'

function timeAgo(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

function notificationIcon(type: string) {
  if (type.includes('referral')) return '👥'
  if (type.includes('binary') || type === 'sponsor_point') return '🔗'
  if (type.startsWith('payout')) return '💸'
  if (type.startsWith('order')) return '🛒'
  if (type.startsWith('payment_method')) return '💳'
  if (type.startsWith('security')) return '🛡️'
  return '🔔'
}

function NotificationToast({ notification }: { notification: Notification }) {
  if (!notification.action_url) return null
  return (
    <Link href={notification.action_url}
      className="fixed bottom-4 left-3 right-3 z-[9999] w-auto rounded-2xl border border-[#0D1B3E]/10 bg-white p-4 shadow-2xl md:bottom-5 md:left-auto md:right-5 md:w-80">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#C9A84C]/15 text-xl">
          {notificationIcon(notification.type)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-[#0D1B3E]">{notification.title}</p>
          <p className="mt-1 text-xs text-gray-500">{notification.message}</p>
        </div>
        <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#e05252]" />
      </div>
    </Link>
  )
}

export default function NotificationBell({ userId, role }: { userId?: string; role?: string }) {
  const { notifications, unreadCount, toast, markAllRead, markOneRead, mounted } =
    useNotifications(userId, 5)
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const allHref = role === 'reseller' ? '/dashboard/reseller/notifications' : null

  const openNotification = async (notification: Notification) => {
    await markOneRead(notification.id)
    setOpen(false)
    if (notification.action_url) router.push(notification.action_url)
  }

  return (
    <>
      {toast && <NotificationToast notification={toast} />}
      <div className="relative">
        <button
          onClick={() => setOpen((value) => !value)}
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 transition-colors hover:bg-white/20">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {mounted && unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#e05252] px-1 text-[9px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="fixed left-3 right-3 top-16 z-50 flex max-h-[calc(100dvh-5rem)] w-auto flex-col overflow-hidden rounded-2xl border border-[#0D1B3E]/10 bg-white shadow-2xl md:absolute md:left-auto md:right-0 md:top-11 md:w-80 md:max-h-[min(32rem,calc(100vh-5rem))]">
              <div className="flex items-center justify-between border-b border-[#0D1B3E]/8 bg-[#f8f9fc] px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-[#0D1B3E]">Notifications</p>
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-[#e05252] px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[10px] text-[#9a6f1e] hover:underline">
                    Mark all read
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center py-10">
                    <span className="mb-2 text-3xl">🔔</span>
                    <p className="text-sm text-gray-400">No notifications yet</p>
                    <p className="mt-1 text-xs text-gray-300">Important account activity will appear here.</p>
                  </div>
                ) : notifications.map((notification) => {
                  const unread = !notification.read_at
                  return (
                    <button key={notification.id} onClick={() => openNotification(notification)}
                      className={`flex w-full items-start gap-3 border-b border-[#0D1B3E]/5 px-4 py-3 text-left transition-colors ${
                        unread
                          ? 'border-l-2 border-l-[#C9A84C] bg-[#fffbeb] hover:bg-[#fef3c7]'
                          : 'bg-white hover:bg-[#f8f9fc]'
                      }`}>
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg ${
                        unread ? 'bg-[#C9A84C]/15' : 'bg-[#f1f5f9]'
                      }`}>{notificationIcon(notification.type)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className={`truncate text-xs ${unread ? 'font-bold text-[#0D1B3E]' : 'font-medium text-gray-500'}`}>
                            {notification.title}
                          </span>
                          <span className="shrink-0 text-[9px] text-gray-400">{timeAgo(notification.created_at)}</span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[11px] text-gray-500">
                          {notification.message}
                        </span>
                      </span>
                      {unread && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#C9A84C]" />}
                    </button>
                  )
                })}
              </div>

              {allHref ? (
                <Link href={allHref} onClick={() => setOpen(false)}
                  className="block shrink-0 border-t border-[#0D1B3E]/8 bg-[#f8f9fc] px-4 py-3 text-center text-xs font-semibold text-[#0D1B3E] hover:text-[#9a6f1e]">
                  See all notifications
                </Link>
              ) : (
                <div className="shrink-0 border-t border-[#0D1B3E]/8 bg-[#f8f9fc] px-4 py-2 text-center text-[10px] text-gray-400">
                  Showing the latest 5 notifications
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
