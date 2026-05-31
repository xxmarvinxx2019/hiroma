'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const INACTIVITY_TIMEOUT = 5 * 60 * 1000  // 5 minutes
const WARNING_BEFORE     = 30 * 1000       // warn 30s before logout

interface UseAutoLogoutOptions {
  onWarning?: (secondsLeft: number) => void
  onActive?:  () => void
  onLogout?:  () => void
  timeout?:   number
}

export function useAutoLogout(options: UseAutoLogoutOptions = {}) {
  const router          = useRouter()
  const { onWarning, onActive, onLogout, timeout = INACTIVITY_TIMEOUT } = options

  const logoutAtRef     = useRef(Date.now() + timeout)
  const isWarningRef    = useRef(false)
  const intervalRef     = useRef<NodeJS.Timeout | null>(null)

  const doLogout = useCallback(async () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    isWarningRef.current = false
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
    if (onLogout) onLogout()
    router.push('/login')
  }, [router, onLogout])

  const stayLoggedIn = useCallback(() => {
    logoutAtRef.current  = Date.now() + timeout
    isWarningRef.current = false
    if (onActive) onActive()
  }, [timeout, onActive])

  useEffect(() => {
    // Reset logout time on user activity — but only if NOT in warning state
    const handleActivity = () => {
      if (isWarningRef.current) return
      logoutAtRef.current = Date.now() + timeout
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'click']
    events.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }))

    // Single interval that checks everything
    intervalRef.current = setInterval(() => {
      const remaining = logoutAtRef.current - Date.now()

      if (remaining <= 0) {
        // Time's up — logout
        doLogout()
        return
      }

      if (remaining <= WARNING_BEFORE) {
        // In warning zone
        const secs = Math.ceil(remaining / 1000)
        if (!isWarningRef.current) {
          isWarningRef.current = true
        }
        if (onWarning) onWarning(secs)
      } else {
        // Outside warning zone — reset if was warning
        if (isWarningRef.current) {
          isWarningRef.current = false
          if (onActive) onActive()
        }
      }
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      events.forEach((e) => window.removeEventListener(e, handleActivity))
    }
  }, [timeout, onWarning, onActive, doLogout])

  return { stayLoggedIn }
}