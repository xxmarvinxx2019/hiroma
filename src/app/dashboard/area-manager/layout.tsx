'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AreaManagerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [name, setName] = useState('Area Manager')
  useEffect(() => { fetch('/api/auth/me', { cache: 'no-store' }).then(async (response) => ({ response, data: await response.json() })).then(({ response, data }) => { if (!response.ok || data.user?.staff_type !== 'area_manager') { router.replace('/login/admin'); return } setName(data.user.full_name) }).catch(() => router.replace('/login/admin')) }, [router])
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login/admin') }
  return <div className="min-h-screen bg-[#F0F2F8] text-[#0D1B3E]"><header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-[#010521] px-4 text-white shadow-lg sm:px-7"><div className="flex items-center gap-3"><Image src="/hiroma-logo.jpg" width={34} height={34} alt="Hiroma" className="rounded-md"/><div><p className="text-sm font-bold tracking-[.18em]">HIROMA</p><p className="text-[10px] uppercase tracking-wide text-white/45">Area Audit Portal</p></div></div><div className="flex items-center gap-3"><div className="text-right"><p className="text-xs font-bold">{name}</p><p className="text-[10px] text-[#C9A84C]">AREA MANAGER</p></div><button onClick={logout} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/10">Sign out</button></div></header><main className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">{children}</main></div>
}
