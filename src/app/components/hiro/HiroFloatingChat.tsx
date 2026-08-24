'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import HiroAssistant from './HiroAssistant'

export default function HiroFloatingChat() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [greeted, setGreeted] = useState(false)

  useEffect(() => {
    if (greeted) return
    const timer = window.setTimeout(() => setGreeted(true), 8000)
    return () => window.clearTimeout(timer)
  }, [greeted])

  if (pathname.startsWith('/dashboard/reseller/hiro')) return null

  return (
    <div className="fixed bottom-3 right-3 z-[80] sm:bottom-4 sm:right-4">
      {open && (
        <div className="mb-2 w-[calc(100vw-1.5rem)] max-w-[390px] overflow-hidden rounded-2xl shadow-2xl sm:mb-3 sm:w-[calc(100vw-2rem)]">
          <div className="relative">
            <HiroAssistant compact />
            <button type="button" onClick={() => setOpen(false)} aria-label="Minimize Hiro" className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-lg text-white hover:bg-white/20">−</button>
          </div>
        </div>
      )}
      {!open && !greeted && (
        <button type="button" onClick={() => setGreeted(true)} aria-label="Dismiss Hiro greeting" className="absolute bottom-24 right-2 hidden w-52 rounded-2xl rounded-br-sm border border-[#0D1B3E]/10 bg-white px-4 py-3 text-left text-xs leading-5 text-[#273552] shadow-xl sm:block sm:bottom-28">
          Hi! I&apos;m Hiro. Do you have a question? 👋
        </button>
      )}
      <button type="button" onClick={() => { setOpen((value) => !value); setGreeted(true) }} aria-label={open ? 'Close Hiro chat' : 'Open Hiro chat'} className="group relative ml-auto flex h-16 w-16 items-center justify-center rounded-full outline-none transition duration-300 hover:-translate-y-1 hover:scale-105 focus-visible:ring-4 focus-visible:ring-[#C9A84C]/40 sm:h-24 sm:w-24">
        <span className="absolute inset-[14%] rounded-full bg-[#C9A84C]/35 blur-xl transition group-hover:bg-[#E7BD45]/50" aria-hidden="true" />
        <Image
          src="/images/hiro/hiro-mascot-floating.png"
          alt="Hiro, the Hiroma Smart Assistant mascot"
          width={112}
          height={112}
          className="relative h-full w-full object-contain drop-shadow-[0_12px_14px_rgba(13,27,62,.45)] sm:[animation:bounce_3.2s_ease-in-out_infinite] sm:group-hover:[animation-play-state:paused]"
          priority
        />
        {!open && <span className="absolute right-0 top-1 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-400 shadow-sm sm:right-2 sm:top-3 sm:h-4 sm:w-4" />}
      </button>
    </div>
  )
}
