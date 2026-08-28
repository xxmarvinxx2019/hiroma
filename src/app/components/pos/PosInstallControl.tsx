'use client'

import { useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export default function PosInstallControl() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,
  )
  const [ios] = useState(() =>
    typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent),
  )
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPromptEvent)
    }
    const onInstalled = () => {
      setStandalone(true)
      setPrompt(null)
      setMessage('Hiroma POS is installed on this device.')
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    const choice = await prompt.userChoice
    if (choice.outcome === 'dismissed') setMessage('Installation was cancelled. You can install later from the browser menu.')
    setPrompt(null)
  }

  if (standalone) return <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">✓ Installed app</span>

  return <div className="flex flex-col items-start gap-1 sm:items-end">
    {prompt && <button type="button" onClick={install} className="rounded-xl bg-[#d4af45] px-4 py-2.5 text-sm font-bold text-[#071638] shadow-sm hover:bg-[#e4c461]">Install Hiroma POS</button>}
    {!prompt && ios && <p className="max-w-xs text-xs text-white/65">To install: tap Share, then “Add to Home Screen.”</p>}
    {!prompt && !ios && <p className="max-w-xs text-xs text-white/55">Install from the Chrome or Edge app menu when available.</p>}
    {message && <p role="status" className="max-w-xs text-xs text-white/70">{message}</p>}
  </div>
}
