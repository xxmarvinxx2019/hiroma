// src/app/components/ui/NotificationBell.tsx
'use client'

import { useState } from 'react'
import { useNotifications, Notification } from '@/app/hooks/useNotifications'

const fmt = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', regional: 'Regional Dist.', provincial: 'Provincial Dist.',
  city: 'City Dist.', reseller: 'Reseller',
}

function timeAgo(date: string) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

export function NotificationToast({ notif }: { notif: Notification }) {
  return (
    <div className="fixed bottom-5 right-5 z-[9999] animate-slide-up">
      <div className="bg-white rounded-2xl shadow-2xl border border-[#0D1B3E]/8 p-4 w-80 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#1a7a4a]/15 flex items-center justify-center text-xl flex-shrink-0">
          🛒
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-[#0D1B3E]">New Order Received!</p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {notif.buyer_name} · {ROLE_LABELS[notif.buyer_role] || notif.buyer_role}
          </p>
          <p className="text-sm font-bold text-[#1a7a4a] mt-1">{fmt(notif.amount)}</p>
          {notif.order_number && (
            <p className="text-[10px] text-gray-400 mt-0.5">{notif.order_number}</p>
          )}
        </div>
        <div className="w-2 h-2 rounded-full bg-[#1a7a4a] flex-shrink-0 mt-1 animate-pulse" />
      </div>
    </div>
  )
}

export default function NotificationBell() {
  const { notifications, unreadCount, toast, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Toast */}
      {toast && <NotificationToast notif={toast} />}

      {/* Bell */}
      <div className="relative">
        <button
          onClick={() => { setOpen(!open); if (!open) markAllRead() }}
          className="relative w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#e05252] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-11 z-50 bg-white rounded-2xl shadow-2xl border border-[#0D1B3E]/8 w-80 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/8 bg-[#f8f9fc]">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-[#0D1B3E]">Notifications</p>
                  {unreadCount > 0 && (
                    <span className="text-[10px] font-bold bg-[#e05252] text-white px-1.5 py-0.5 rounded-full">{unreadCount}</span>
                  )}
                </div>
                {notifications.length > 0 && (
                  <button onClick={markAllRead} className="text-[10px] text-[#C9A84C] hover:underline">
                    Mark all read
                  </button>
                )}
              </div>

              {/* List */}
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center py-10">
                    <span className="text-3xl mb-2">🔔</span>
                    <p className="text-sm text-gray-400">No notifications yet</p>
                    <p className="text-xs text-gray-300 mt-1">New orders will appear here</p>
                  </div>
                ) : notifications.map(n => (
                  <div key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors ${!n.read ? 'bg-[#fffbeb]' : ''}`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${!n.read ? 'bg-[#1a7a4a]/15' : 'bg-[#f1f5f9]'}`}>
                      🛒
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-semibold text-[#0D1B3E] truncate">New Order</p>
                        <p className="text-[9px] text-gray-400 flex-shrink-0">{timeAgo(n.created_at)}</p>
                      </div>
                      <p className="text-[11px] text-gray-500 truncate">{n.buyer_name} · {ROLE_LABELS[n.buyer_role] || n.buyer_role}</p>
                      <p className="text-xs font-bold text-[#1a7a4a]">{fmt(n.amount)}</p>
                      {n.order_number && <p className="text-[9px] text-gray-400">{n.order_number}</p>}
                    </div>
                    {!n.read && <div className="w-2 h-2 rounded-full bg-[#C9A84C] flex-shrink-0 mt-1" />}
                  </div>
                ))}
              </div>

              {notifications.length > 0 && (
                <div className="px-4 py-2 border-t border-[#0D1B3E]/8 text-center">
                  <p className="text-[10px] text-gray-400">{notifications.length} notification{notifications.length !== 1 ? 's' : ''} total</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}