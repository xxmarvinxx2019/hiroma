'use client'

import { useState, useEffect } from 'react'
import NotificationBell from '@/app/components/ui/NotificationBell'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useAutoLogout } from '@/app/hooks/useAutoLogout'

const navItems = [
  {
    section: 'Main',
    items: [
      { label: 'Dashboard', href: '/dashboard/admin', icon: '📊' },
      { label: 'Distributors', href: '/dashboard/admin/distributors', icon: '🗺️' },
      { label: 'Resellers',        href: '/dashboard/admin/resellers',          icon: '👥' },
    ],
  },
  {
    section: 'Catalog',
    items: [
      { label: 'Products', href: '/dashboard/admin/products', icon: '🧴' },
      { label: 'Ranks',    href: '/dashboard/admin/ranks',    icon: '🏅' },
      { label: 'Packages', href: '/dashboard/admin/packages', icon: '📦' },
      { label: 'PIN Manager', href: '/dashboard/admin/pins', icon: '🔑' },
      { label: 'Inventory', href: '/dashboard/admin/inventory', icon: '🏭' },
    ],
  },
  {
    section: 'Finance',
    items: [
      { label: 'Orders', href: '/dashboard/admin/orders', icon: '🛒' },
      { label: 'Payouts', href: '/dashboard/admin/payouts', icon: '💸', badge: true },
      { label: 'Payment Methods', href: '/dashboard/admin/payment-methods', icon: '💳' },
      { label: 'PIN Requests',     href: '/dashboard/admin/pin-requests',     icon: '🔑', badge: 'pinRequests' },
      { label: 'Commissions',       href: '/dashboard/admin/commissions', icon: '💰' },
      { label: 'Reports',            href: '/dashboard/admin/reports',     icon: '📈' },
      { label: 'Flushout/Overflow',  href: '/dashboard/admin/flushout',    icon: '⚡' },
    ],
  },
]

function Sidebar({
  user,
  pendingPayouts,
  pendingPinRequests,
  pathname,
  onClose,
  onLogout,
}: {
  user: { full_name: string; username: string } | null
  pendingPayouts: number
  pendingPinRequests: number
  pathname: string
  onClose: () => void
  onLogout: () => void
}) {
  const isActive = (href: string) => {
    if (href === '/dashboard/admin') return pathname === href
    // Exact match for these to avoid parent highlighting child routes
    if (href === '/dashboard/admin/resellers') return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <div
      className="bg-[#0D1B3E] flex flex-col w-56"
      style={{ height: '100vh' }}
    >
      {/* ── Logo — never moves ── */}
      <div
        className="px-4 flex items-center gap-3 border-b border-white/5 flex-shrink-0"
        style={{ height: '56px' }}
      >
        <div className="w-8 h-8 relative flex-shrink-0">
          <Image
            src="/hiroma-logo.jpg"
            alt="Hiroma"
            fill
            className="object-contain rounded-md"
          />
        </div>
        <span className="text-white font-medium text-sm tracking-[0.2em]">
          HIROMA
        </span>
      </div>

      {/* ── Nav — scrolls if needed, hidden scrollbar ── */}
      <nav
        className="flex-1 py-3 px-3"
        style={{
          overflowY: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        <style>{`nav::-webkit-scrollbar { display: none; }`}</style>
        {navItems.map((group) => (
          <div key={group.section} className="mb-3">
            <p className="text-white/30 text-xs font-medium tracking-widest uppercase px-2 py-1">
              {group.section}
            </p>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-0.5 transition-all duration-150 ${
                  isActive(item.href)
                    ? 'bg-[#C9A84C]/15 text-[#C9A84C] border-l-2 border-[#C9A84C] rounded-l-none pl-2.5'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.badge === true && pendingPayouts > 0 && (
                  <span className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {pendingPayouts}
                  </span>
                )}
                {item.badge === 'pinRequests' && pendingPinRequests > 0 && (
                  <span className="bg-[#e05252] text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {pendingPinRequests}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* ── User Footer — always visible at bottom ── */}
      <div
        className="px-3 py-3 border-t border-white/5 bg-[#0D1B3E] flex-shrink-0"
      >
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-7 h-7 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center flex-shrink-0">
            <span className="text-[#C9A84C] text-xs font-bold">
              {user?.full_name?.charAt(0) || 'A'}
            </span>
          </div>
          <div className="overflow-hidden">
            <p className="text-white text-xs font-medium truncate">
              {user?.full_name || 'Admin'}
            </p>
            <p className="text-white/40 text-xs truncate">
              @{user?.username || 'hiroadmin'}
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [showWarning, setShowWarning] = useState(false)
  const [countdown, setCountdown]     = useState(30)

  const { stayLoggedIn } = useAutoLogout({
    onWarning: (secs) => { setShowWarning(true); setCountdown(secs) },
    onActive:  ()     => { setShowWarning(false); setCountdown(30) },
    onLogout:  ()     => { setShowWarning(false) },
  })
  const [sidebarOpen, setSidebarOpen]   = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [user, setUser] = useState<{ full_name: string; username: string } | null>(null)
  const [pendingPayouts, setPendingPayouts]         = useState(0)
  const [pendingPinRequests, setPendingPinRequests] = useState(0)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => { if (data.user) setUser(data.user) })
      .catch(() => router.push('/login'))
  }, [router])

  useEffect(() => {
    fetch('/api/admin/payouts/pending-count')
      .then((res) => res.json())
      .then((data) => setPendingPayouts(data.count || 0))
      .catch(() => {})

    fetch('/api/pin-requests?status=pending&pageSize=1')
      .then((res) => res.json())
      .then((data) => setPendingPinRequests(data.summary?.pending || 0))
      .catch(() => {})
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const currentLabel =
    navItems
      .flatMap((g) => g.items)
      .find((i) =>
        i.href === '/dashboard/admin'
          ? pathname === i.href
          : pathname.startsWith(i.href)
      )?.label || 'Dashboard'

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: '#F0F2F8',
      }}
    >
      {/* Inactivity warning */}
      {showWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-[#9a6f1e] text-white text-sm px-6 py-3 rounded-xl shadow-xl flex items-center gap-3 whitespace-nowrap">
          <span>⚠️ You will be logged out in <strong>{countdown}s</strong> due to inactivity. Move your mouse or press any key to stay logged in.</span>
          <button
            onClick={() => setShowWarning(false)}
            className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0"
          >
            Stay logged in
          </button>
        </div>
      )}
      {/* Desktop Sidebar */}
      <div className="hidden md:block flex-shrink-0">
        <Sidebar
          user={user}
          pendingPayouts={pendingPayouts}
          pendingPinRequests={pendingPinRequests}
          pathname={pathname}
          onClose={() => {}}
          onLogout={handleLogout}
        />
      </div>

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed top-0 left-0 z-30 md:hidden">
            <Sidebar
              user={user}
              pendingPayouts={pendingPayouts}
          pendingPinRequests={pendingPinRequests}
              pathname={pathname}
              onClose={() => setSidebarOpen(false)}
              onLogout={handleLogout}
            />
          </div>
        </>
      )}

      {/* Main */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {/* Topbar */}
        <header
          className="bg-[#0D1B3E] flex items-center justify-between px-4 border-b border-white/5 flex-shrink-0"
          style={{ height: '56px' }}
        >
          <div className="flex items-center gap-3">
            <button
              className="md:hidden text-white/60 hover:text-white"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="text-white/60 text-sm">{currentLabel}</span>
          </div>

          <div className="flex items-center gap-3">
            {pendingPayouts > 0 && (
              <Link
                href="/dashboard/admin/payouts"
                className="flex items-center gap-1.5 bg-[#C9A84C]/15 border border-[#C9A84C]/30 text-[#C9A84C] text-xs px-3 py-1.5 rounded-full hover:bg-[#C9A84C]/25 transition-colors"
              >
                <span>💸</span>
                <span>{pendingPayouts} pending</span>
              </Link>
            )}
            <NotificationBell />
            <span className="bg-[#C9A84C]/20 text-[#C9A84C] text-xs font-semibold px-3 py-1 rounded-full border border-[#C9A84C]/30 tracking-wide">
              ADMIN
            </span>
            <div className="relative">
              <button
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                className="w-8 h-8 rounded-full bg-[#1A2F5E] border-2 border-[#C9A84C]/50 flex items-center justify-center hover:border-[#C9A84C] transition-colors">
                <span className="text-[#C9A84C] text-xs font-bold">
                  {user?.full_name?.charAt(0) || 'A'}
                </span>
              </button>
              {profileMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} />
                  <div className="absolute right-0 top-10 z-50 bg-white rounded-2xl shadow-xl border border-[#0D1B3E]/8 w-52 overflow-hidden">
                    {/* User info */}
                    <div className="px-4 py-3 border-b border-[#0D1B3E]/8 bg-[#f8f9fc]">
                      <p className="text-xs font-bold text-[#0D1B3E]">{user?.full_name || 'Admin'}</p>
                      <p className="text-[10px] text-gray-400">@{user?.username || 'hiroadmin'}</p>
                    </div>
                    {/* Menu items */}
                    <div className="py-1">
                      <Link href="/dashboard/admin/tiers" onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f9fc] transition-colors">
                        <span className="text-base">⚙️</span>
                        <span className="text-xs text-[#0D1B3E] font-medium">Tier Settings</span>
                      </Link>
                      <Link href="/dashboard/admin/settings" onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f9fc] transition-colors">
                        <span className="text-base">🔧</span>
                        <span className="text-xs text-[#0D1B3E] font-medium">Settings</span>
                      </Link>
                    </div>
                    <div className="border-t border-[#0D1B3E]/8 py-1">
                      <button onClick={() => { setProfileMenuOpen(false); handleLogout() }}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#fdecea] transition-colors w-full text-left">
                        <span className="text-base">🚪</span>
                        <span className="text-xs text-[#e05252] font-medium">Sign Out</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {children}
        </main>
      </div>
    </div>
  )
}