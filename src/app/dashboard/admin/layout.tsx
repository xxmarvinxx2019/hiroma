'use client'

import { useState, useEffect } from 'react'
import NotificationBell from '@/app/components/ui/NotificationBell'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useAutoLogout } from '@/app/hooks/useAutoLogout'
import {
  adminStaffPermissionForPath,
  firstAdminStaffRoute,
} from '@/app/lib/staffPermissions'

const navItems = [
  {
    section: 'Main',
    items: [
      { label: 'Dashboard', href: '/dashboard/admin', icon: '📊' },
      {
        label: 'Distributors',
        href: '/dashboard/admin/distributors',
        icon: '🗺️',
      },
      { label: 'Branches', href: '/dashboard/admin/branches', icon: '🏢' },
      { label: 'Resellers', href: '/dashboard/admin/resellers', icon: '👥' },
      {
        label: 'Top Performers',
        href: '/dashboard/admin/top-performers',
        icon: '🏆',
      },
    ],
  },
  {
    section: 'Network',
    items: [
      { label: 'Binary Tree', href: '/dashboard/admin/network', icon: '🌳' },
    ],
  },
  {
    section: 'Catalog',
    items: [
      { label: 'Products', href: '/dashboard/admin/products', icon: '🧴' },
      { label: 'Ranks', href: '/dashboard/admin/ranks', icon: '🏅' },
      { label: 'Packages', href: '/dashboard/admin/packages', icon: '📦' },
      { label: 'PIN Manager', href: '/dashboard/admin/pins', icon: '🔑' },
      { label: 'Inventory', href: '/dashboard/admin/inventory', icon: '🏭' },
    ],
  },
  {
    section: 'Finance',
    items: [
      { label: 'Orders', href: '/dashboard/admin/orders', icon: '🛒' },
      { label: 'Payouts', href: '/dashboard/admin/payouts', icon: '💸' },
      {
        label: 'Payment Methods',
        href: '/dashboard/admin/payment-methods',
        icon: '💳',
      },
      {
        label: 'PIN Requests',
        href: '/dashboard/admin/pin-requests',
        icon: '🔑',
      },
      {
        label: 'Commissions',
        href: '/dashboard/admin/commissions',
        icon: '💰',
      },
      {
        label: 'Sales & Movement',
        href: '/dashboard/admin/sales-movement',
        icon: '📊',
      },
      {
        label: 'Commission Testing',
        icon: '🧪',
        children: [
          {
            label: 'Direct Referral',
            href: '/dashboard/admin/commission-testing/direct-referral',
          },
          {
            label: 'Binary Commission',
            href: '/dashboard/admin/commission-testing/binary-commission',
          },
          {
            label: 'Product Binary',
            href: '/dashboard/admin/commission-testing/product-binary',
          },
          {
            label: 'Ranking Engine',
            href: '/dashboard/admin/commission-testing/ranking-engine',
          },
          {
            label: 'Reserve Ledger',
            href: '/dashboard/admin/commission-testing/reserve-ledger',
          },
          {
            label: 'Payout Ledger',
            href: '/dashboard/admin/commission-testing/payout-ledger',
          },
          {
            label: 'Flushout Report',
            href: '/dashboard/admin/commission-testing/flushout-report',
          },
        ],
      },
      { label: 'Reports', href: '/dashboard/admin/reports', icon: '📈' },
      {
        label: 'Report Testing',
        href: '/dashboard/admin/report-testing',
        icon: '🧪',
      },
      {
        label: 'Flushout/Overflow',
        href: '/dashboard/admin/flushout',
        icon: '⚡',
      },
    ],
  },
  {
    section: 'Security',
    items: [
      {
        label: 'Maintenance',
        href: '/dashboard/admin/maintenance',
        icon: '🛠️',
      },
      { label: 'Audit Logs', href: '/dashboard/admin/audit-logs', icon: '🛡️' },
      {
        label: 'Support Center',
        href: '/dashboard/admin/support-center',
        icon: '🎧',
      },
      {
        label: 'Staff Access',
        href: '/dashboard/admin/support-staff',
        icon: '🧑‍💼',
      },
      {
        label: 'Area Managers',
        href: '/dashboard/admin/area-managers',
        icon: '🧭',
      },
    ],
  },
]

function Sidebar({
  user,
  pathname,
  pendingOrderCount,
  onClose,
  onLogout,
}: {
  user: {
    id: string
    full_name: string
    username: string
    profile_photo?: string | null
    is_staff?: boolean
    permissions?: string[]
  } | null
  pathname: string
  pendingOrderCount: number
  onClose: () => void
  onLogout: () => void
}) {
  const [commissionTestingOpen, setCommissionTestingOpen] = useState(() =>
    pathname.startsWith('/dashboard/admin/commission-testing'),
  )

  const isActive = (href: string) => {
    if (href === '/dashboard/admin') return pathname === href
    // Exact match for these to avoid parent highlighting child routes
    if (href === '/dashboard/admin/resellers') return pathname === href
    return pathname.startsWith(href)
  }

  const visibleNavItems = navItems
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!user) return false
        if (!user.is_staff) return true
        if ('children' in item) return false
        const required = adminStaffPermissionForPath(item.href)
        return (
          required !== '__owner_only__' &&
          required !== null &&
          Boolean(user.permissions?.includes(required))
        )
      }),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <div
      className="bg-[#010521] flex flex-col w-56"
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
        className="scrollbar-hide flex-1 py-3 px-3"
        style={{
          overflowY: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {visibleNavItems.map((group) => (
          <div key={group.section} className="mb-3">
            <p className="text-white/30 text-xs font-medium tracking-widest uppercase px-2 py-1">
              {group.section}
            </p>
            {group.items.map((item) =>
              'children' in item ? (
                <div key={item.label} className="mb-0.5">
                  <button
                    type="button"
                    onClick={() => setCommissionTestingOpen((open) => !open)}
                    aria-expanded={commissionTestingOpen}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all duration-150 ${
                      item.children.some((child) => isActive(child.href))
                        ? 'bg-[#C9A84C]/15 text-[#C9A84C]'
                        : 'text-white/50 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    <span
                      className={`text-xs transition-transform ${commissionTestingOpen ? 'rotate-180' : ''}`}
                    >
                      ⌄
                    </span>
                  </button>
                  {commissionTestingOpen && (
                    <div className="ml-5 mt-1 border-l border-white/20 pl-2">
                      {item.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClose}
                          className={`mb-0.5 flex rounded-md px-3 py-1.5 text-xs transition-colors ${
                            isActive(child.href)
                              ? 'bg-[#C9A84C]/15 text-[#C9A84C]'
                              : 'text-white/50 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
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
                  {item.href === '/dashboard/admin/orders' &&
                    pendingOrderCount > 0 && (
                      <span
                        aria-label={`${pendingOrderCount} pending orders`}
                        className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#e05252] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm"
                      >
                        {pendingOrderCount > 99 ? '99+' : pendingOrderCount}
                      </span>
                    )}
                </Link>
              ),
            )}
          </div>
        ))}
      </nav>

      {/* ── User Footer — always visible at bottom ── */}
      <div className="px-3 py-3 border-t border-white/5 bg-[#010521] flex-shrink-0">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-7 h-7 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {user?.profile_photo ? (
              <img
                src={user.profile_photo}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-[#C9A84C] text-xs font-bold">
                {user?.full_name?.charAt(0) || 'A'}
              </span>
            )}
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
  const [countdown, setCountdown] = useState(30)

  const { stayLoggedIn } = useAutoLogout({
    onWarning: (secs) => {
      setShowWarning(true)
      setCountdown(secs)
    },
    onActive: () => {
      setShowWarning(false)
      setCountdown(30)
    },
    onLogout: () => {
      setShowWarning(false)
    },
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [user, setUser] = useState<{
    id: string
    full_name: string
    username: string
    profile_photo?: string | null
    is_staff?: boolean
    permissions?: string[]
  } | null>(null)
  const [pendingOrderCount, setPendingOrderCount] = useState(0)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setUser(data.user)
      })
      .catch(() => router.push('/login'))
  }, [router])

  useEffect(() => {
    if (!user?.is_staff) return
    const required = adminStaffPermissionForPath(pathname)
    if (
      required === '__owner_only__' ||
      (required && !user.permissions?.includes(required))
    ) {
      router.replace(firstAdminStaffRoute(user.permissions || []))
    }
  }, [pathname, router, user])

  useEffect(() => {
    if (!user) return
    if (user.is_staff && !user.permissions?.includes('orders')) return

    const loadPendingOrders = async () => {
      try {
        const response = await fetch('/api/admin/orders/pending-count', {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!response.ok) return
        const data = await response.json()
        setPendingOrderCount(Number(data.pending || 0))
      } catch {}
    }

    void loadPendingOrders()
    const timer = window.setInterval(loadPendingOrders, 15_000)
    window.addEventListener('focus', loadPendingOrders)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', loadPendingOrders)
    }
  }, [pathname, user])

  useEffect(() => {
    const updatePhoto = (event: Event) =>
      setUser((current) =>
        current
          ? {
              ...current,
              profile_photo: (event as CustomEvent<string | null>).detail,
            }
          : current,
      )
    window.addEventListener('hiroma-profile-photo-change', updatePhoto)
    return () =>
      window.removeEventListener('hiroma-profile-photo-change', updatePhoto)
  }, [])

  useEffect(() => {}, [])

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
          : pathname.startsWith(i.href),
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
          <span>
            ⚠️ You will be logged out in <strong>{countdown}s</strong> due to
            inactivity. Move your mouse or press any key to stay logged in.
          </span>
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
          pathname={pathname}
          pendingOrderCount={pendingOrderCount}
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
              pathname={pathname}
              pendingOrderCount={pendingOrderCount}
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
          className="bg-[#010521] flex items-center justify-between px-4 border-b border-white/5 flex-shrink-0"
          style={{ height: '56px' }}
        >
          <div className="flex items-center gap-3">
            <button
              className="md:hidden text-white/60 hover:text-white"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
            <span className="text-white/60 text-sm">{currentLabel}</span>
          </div>

          <div className="flex items-center gap-3">
            <NotificationBell userId={user?.id} role="admin" />
            <span className="bg-[#C9A84C]/20 text-[#C9A84C] text-xs font-semibold px-3 py-1 rounded-full border border-[#C9A84C]/30 tracking-wide">
              ADMIN
            </span>
            <div className="relative">
              <button
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                className="w-8 h-8 rounded-full bg-[#1A2F5E] border-2 border-[#C9A84C]/50 flex items-center justify-center overflow-hidden hover:border-[#C9A84C] transition-colors"
              >
                {user?.profile_photo ? (
                  <img
                    src={user.profile_photo}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-[#C9A84C] text-xs font-bold">
                    {user?.full_name?.charAt(0) || 'A'}
                  </span>
                )}
              </button>
              {profileMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setProfileMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-10 z-50 bg-white rounded-2xl shadow-xl border border-[#0D1B3E]/8 w-52 overflow-hidden">
                    {/* User info */}
                    <div className="px-4 py-3 border-b border-[#0D1B3E]/8 bg-[#f8f9fc]">
                      <p className="text-xs font-bold text-[#0D1B3E]">
                        {user?.full_name || 'Admin'}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        @{user?.username || 'hiroadmin'}
                      </p>
                    </div>
                    {/* Menu items */}
                    <div className="py-1">
                      <Link
                        href="/dashboard/admin/tiers"
                        onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f9fc] transition-colors"
                      >
                        <span className="text-base">⚙️</span>
                        <span className="text-xs text-[#0D1B3E] font-medium">
                          Tier Settings
                        </span>
                      </Link>
                      <Link
                        href="/dashboard/admin/settings"
                        onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f9fc] transition-colors"
                      >
                        <span className="text-base">🔧</span>
                        <span className="text-xs text-[#0D1B3E] font-medium">
                          Settings
                        </span>
                      </Link>
                    </div>
                    <div className="border-t border-[#0D1B3E]/8 py-1">
                      <button
                        onClick={() => {
                          setProfileMenuOpen(false)
                          handleLogout()
                        }}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#fdecea] transition-colors w-full text-left"
                      >
                        <span className="text-base">🚪</span>
                        <span className="text-xs text-[#e05252] font-medium">
                          Sign Out
                        </span>
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
