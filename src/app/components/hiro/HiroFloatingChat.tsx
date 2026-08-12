'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import HiroAssistant from './HiroAssistant'

export default function HiroFloatingChat() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [greeted, setGreeted] = useState(false)

  if (pathname.startsWith('/dashboard/reseller/hiro')) return null

  return (
    <div className="fixed bottom-4 right-4 z-[80] sm:bottom-6 sm:right-6">
      {open && (
        <div className="mb-3 w-[calc(100vw-2rem)] max-w-[390px] overflow-hidden rounded-2xl shadow-2xl">
          <div className="relative">
            <HiroAssistant compact />
            <button type="button" onClick={() => setOpen(false)} aria-label="Minimize Hiro" className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-lg text-white hover:bg-white/20">−</button>
          </div>
        </div>
      )}
      {!open && !greeted && (
        <button type="button" onClick={() => { setOpen(true); setGreeted(true) }} className="absolute bottom-24 right-2 w-52 rounded-2xl rounded-br-sm border border-[#0D1B3E]/10 bg-white px-4 py-3 text-left text-xs leading-5 text-[#273552] shadow-xl">
          Hi! Ako si Hiro. Naa kay pangutana? 👋
        </button>
      )}
      <button type="button" onClick={() => { setOpen((value) => !value); setGreeted(true) }} aria-label={open ? 'Close Hiro chat' : 'Open Hiro chat'} className="group relative ml-auto flex h-24 w-24 items-center justify-center rounded-full outline-none transition duration-300 hover:-translate-y-1 hover:scale-105 focus-visible:ring-4 focus-visible:ring-[#C9A84C]/40 sm:h-28 sm:w-28">
        <span className="absolute inset-[14%] rounded-full bg-[#C9A84C]/35 blur-xl transition group-hover:bg-[#E7BD45]/50" aria-hidden="true" />
        <Image
          src="/images/hiro/hiro-mascot-floating.png"
          alt="Hiro, the Hiroma Smart Assistant mascot"
          width={112}
          height={112}
          className="relative h-full w-full object-contain drop-shadow-[0_12px_14px_rgba(13,27,62,.45)] [animation:bounce_3.2s_ease-in-out_infinite] group-hover:[animation-play-state:paused]"
          priority
        />
        {!open && <span className="absolute right-1 top-2 h-4 w-4 rounded-full border-2 border-white bg-emerald-400 shadow-sm sm:right-2 sm:top-3" />}
      </button>
    </div>
  )
}
