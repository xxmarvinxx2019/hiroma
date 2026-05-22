'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const INACTIVITY_TIMEOUT = 5 * 60 * 1000 // 5 minutes in ms
const WARNING_BEFORE     = 30 * 1000      // show warning 30 seconds before logout

interface UseAutoLogoutOptions {
  onWarning?: (secondsLeft: number) => void
  onLogout?:  () => void
  timeout?:   number // override timeout in ms
}

export function useAutoLogout(options: UseAutoLogoutOptions = {}) {
  const router       = useRouter()
  const timerRef     = useRef<NodeJS.Timeout | null>(null)
  const warningRef   = useRef<NodeJS.Timeout | null>(null)
  const { onWarning, onLogout, timeout = INACTIVITY_TIMEOUT } = options

  const doLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {}
    if (onLogout) onLogout()
    router.push('/login')
  }, [router, onLogout])

  const resetTimer = useCallback(() => {
    // Clear existing timers
    if (timerRef.current)   clearTimeout(timerRef.current)
    if (warningRef.current) clearTimeout(warningRef.current)

    // Set warning timer
    if (onWarning) {
      warningRef.current = setTimeout(() => {
        onWarning(Math.floor(WARNING_BEFORE / 1000))
      }, timeout - WARNING_BEFORE)
    }

    // Set logout timer
    timerRef.current = setTimeout(doLogout, timeout)
  }, [timeout, doLogout, onWarning])

  useEffect(() => {
    // Events that reset the inactivity timer
    const events = [
      'mousedown', 'mousemove', 'keydown',
      'scroll', 'touchstart', 'click', 'wheel',
    ]

    const handleActivity = () => resetTimer()

    // Start timer on mount
    resetTimer()

    // Listen for activity
    events.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }))

    return () => {
      if (timerRef.current)   clearTimeout(timerRef.current)
      if (warningRef.current) clearTimeout(warningRef.current)
      events.forEach((e) => window.removeEventListener(e, handleActivity))
    }
  }, [resetTimer])
}