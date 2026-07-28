'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useAutoLogout } from '@/app/hooks/useAutoLogout'
import NotificationBell from '@/app/components/ui/NotificationBell'
import styles from './reseller-theme.module.css'

type ThemePreference = 'off' | 'on' | 'automatic'

const navItems = [
  {
    section: 'Main',
    items: [
      { label: 'Dashboard',     href: '/dashboard/reseller', icon: '📊' },
    ],
  },
  {
    section: 'My Network',
    items: [
      { label: 'Binary Tree',   href: '/dashboard/reseller/tree', icon: '🌳' },
      { label: 'Affiliates',    href: '/dashboard/reseller/genealogy', icon: '👥' },
      { label: 'Rank Advancement', href: '/dashboard/reseller/points', icon: '♙', premiumOnly: true },
    ],
  },
  {
    section: 'Earnings',
    items: [
      { label: 'Wallet',         href: '/dashboard/reseller/wallet', icon: '💰' },
      { label: 'Payouts',        href: '/dashboard/reseller/payouts', icon: '💸' },
      { label: 'Payment Method', href: '/dashboard/reseller/payment-methods', icon: '💳' },
    ],
  },
  {
    section: 'Orders',
    items: [
      { label: 'Order History',  href: '/dashboard/reseller/orders', icon: '🛒' },
      { label: 'My Orders', href: '/dashboard/reseller/orders', icon: '▤', premiumOnly: true },
    ],
  },
]

function Sidebar({
  user,
  pathname,
  onClose,
  onLogout,
  theme,
  onThemeChange,
}: {
  user: { full_name: string; username: string } | null
  pathname: string
  onClose: () => void
  onLogout: () => void
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
}) {
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const isActive = (href: string) => {
    if (href === '/dashboard/reseller') return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <div className="bg-[#0D1B3E] flex flex-col w-56" style={{ height: '100vh' }}>

      {/* Logo */}
      <div
        className="px-4 flex items-center gap-3 border-b border-white/5 flex-shrink-0"
        style={{ height: '56px' }}
      >
        <div className="w-8 h-8 relative flex-shrink-0">
          <Image src="/hiroma-logo.jpg" alt="Hiroma" fill className="object-contain rounded-md" />
        </div>
        <span className="text-white font-medium text-sm tracking-[0.2em]">HIROMA</span>
      </div>

      {/* Nav */}
      <nav
        className="flex-1 py-3 px-3"
        style={{ overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <style>{`nav::-webkit-scrollbar { display: none; }`}</style>
        {navItems.map((group) => (
          <div key={group.section} className="mb-3">
            <p className="text-white/30 text-xs font-medium tracking-widest uppercase px-2 py-1">
              {group.section}
            </p>
            {group.items.filter((item) => item.label !== 'Order History').map((item) => (
              <Link
                key={`${group.section}-${item.label}`}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-0.5 transition-all duration-150 ${'premiumOnly' in item && item.premiumOnly ? styles.premiumNavItem : ''} ${
                  isActive(item.href)
                    ? 'bg-[#C9A84C]/15 text-[#C9A84C] border-l-2 border-[#C9A84C] rounded-l-none pl-2.5'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="w-5 text-center text-sm flex-shrink-0" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* Display preference */}
      <div className="relative px-3 pb-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => setThemeMenuOpen((open) => !open)}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-white/55 transition-colors hover:bg-white/5 hover:text-white"
          aria-expanded={themeMenuOpen}
          aria-haspopup="menu"
        >
          <span className="w-5 text-center text-base" aria-hidden="true">☾</span>
          <span className="flex-1">Dark mode</span>
          <span className="text-[10px] font-semibold uppercase text-[#C9A84C]">
            {theme === 'automatic' ? 'Auto' : theme}
          </span>
        </button>

        {themeMenuOpen && (
          <>
            <button
              type="button"
              aria-label="Close dark mode menu"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setThemeMenuOpen(false)}
            />
            <div
              role="menu"
              className="absolute bottom-full left-3 right-3 z-50 mb-2 overflow-hidden rounded-xl border border-white/10 bg-[#13244a] p-1.5 shadow-2xl"
            >
              {([
                ['off', 'Off', 'Use Hiroma light display'],
                ['on', 'On', 'Use Hiroma navy display'],
                ['automatic', 'Automatic', 'Follow this device setting'],
              ] as const).map(([value, label, description]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === value}
                  onClick={() => {
                    onThemeChange(value)
                    setThemeMenuOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    theme === value ? 'bg-[#C9A84C]/15' : 'hover:bg-white/5'
                  }`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                    theme === value
                      ? 'border-[#C9A84C] bg-[#C9A84C] text-[#0D1B3E]'
                      : 'border-white/30'
                  }`}>
                    {theme === value && <span className="text-[10px] font-bold">✓</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-white">{label}</span>
                    <span className="block text-[10px] text-white/40">{description}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* User Footer */}
      <div className="px-3 py-3 border-t border-white/5 bg-[#0D1B3E] flex-shrink-0">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-7 h-7 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center flex-shrink-0">
            <span className="text-[#C9A84C] text-xs font-bold">
              {user?.full_name?.charAt(0) || 'R'}
            </span>
          </div>
          <div className="overflow-hidden">
            <p className="text-white text-xs font-medium truncate">{user?.full_name || 'Reseller'}</p>
            <p className="text-white/40 text-xs truncate">@{user?.username || ''}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full text-left text-white/40 text-xs hover:text-red-400 transition-colors duration-150 px-1 py-1 cursor-pointer"
        >
          Sign out →
        </button>
      </div>
    </div>
  )
}

export default function ResellerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [showWarning, setShowWarning] = useState(false)
  const [countdown, setCountdown]     = useState(30)

  const { stayLoggedIn } = useAutoLogout({
    onWarning: (secs) => { setShowWarning(true); setCountdown(secs) },
    onActive:  ()     => { setShowWarning(false); setCountdown(30) },
    onLogout:  ()     => { setShowWarning(false) },
  })
  const [sidebarOpen, setSidebarOpen]     = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [user, setUser] = useState<{ id: string; full_name: string; username: string } | null>(null)
  const [theme, setTheme] = useState<ThemePreference>('off')
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem('hiroma-reseller-theme')
    if (stored === 'off' || stored === 'on' || stored === 'automatic') {
      setTheme(stored)
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemTheme = () => setSystemDark(media.matches)
    syncSystemTheme()
    media.addEventListener('change', syncSystemTheme)
    return () => media.removeEventListener('change', syncSystemTheme)
  }, [])

  const handleThemeChange = (preference: ThemePreference) => {
    setTheme(preference)
    window.localStorage.setItem('hiroma-reseller-theme', preference)
  }

  const darkMode = theme === 'on' || (theme === 'automatic' && systemDark)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => { if (data.user) setUser(data.user) })
      .catch(() => router.push('/login'))
  }, [router])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const currentLabel =
    navItems
      .flatMap((g) => g.items)
      .find((i) =>
        i.href === '/dashboard/reseller'
          ? pathname === i.href
          : pathname.startsWith(i.href)
      )?.label || (pathname === '/dashboard/reseller/notifications' ? 'Notifications' : 'Dashboard')

  return (
    <div
      className={`${styles.shell} ${darkMode ? styles.dark : ''}`}
      data-reseller-theme={darkMode ? 'dark' : 'light'}
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: darkMode ? '#050D20' : '#F0F2F8',
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
          pathname={pathname}
          onClose={() => {}}
          onLogout={handleLogout}
          theme={theme}
          onThemeChange={handleThemeChange}
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
              onClose={() => setSidebarOpen(false)}
              onLogout={handleLogout}
              theme={theme}
              onThemeChange={handleThemeChange}
            />
          </div>
        </>
      )}

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

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
            <NotificationBell userId={user?.id} role="reseller" />
            <span className="bg-[#C9A84C]/20 text-[#C9A84C] text-xs font-semibold px-3 py-1 rounded-full border border-[#C9A84C]/30 tracking-wide">
              RESELLER
            </span>
            <div className="relative">
              <button
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                className="w-8 h-8 rounded-full bg-[#1A2F5E] border-2 border-[#C9A84C]/50 flex items-center justify-center hover:border-[#C9A84C] transition-colors">
                <span className="text-[#C9A84C] text-xs font-bold">
                  {user?.full_name?.charAt(0) || 'R'}
                </span>
              </button>
              {profileMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} />
                  <div className="absolute right-0 top-10 z-50 bg-white rounded-2xl shadow-xl border border-[#0D1B3E]/8 w-52 overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#0D1B3E]/8 bg-[#f8f9fc]">
                      <p className="text-xs font-bold text-[#0D1B3E]">{user?.full_name || 'Reseller'}</p>
                      <p className="text-[10px] text-gray-400">@{user?.username || ''}</p>
                    </div>
                    <div className="py-1">
                      <Link href="/dashboard/reseller/profile" onClick={() => setProfileMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8f9fc] transition-colors">
                        <span className="text-base">👤</span>
                        <span className="text-xs text-[#0D1B3E] font-medium">Profile</span>
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
        <main className={styles.pageContent} style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
