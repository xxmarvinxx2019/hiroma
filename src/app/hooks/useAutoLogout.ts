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
  const router = useRouter()
  const { onWarning, onActive, onLogout, timeout = INACTIVITY_TIMEOUT } = options

  const logoutAtRef    = useRef(Date.now() + timeout)
  const isWarningRef   = useRef(false)
  const isLoggedOutRef = useRef(false)
  const intervalRef    = useRef<NodeJS.Timeout | null>(null)

  const doLogout = useCallback(async () => {
    if (isLoggedOutRef.current) return
    isLoggedOutRef.current = true
    if (intervalRef.current) clearInterval(intervalRef.current)
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
    if (onLogout) onLogout()
    router.push('/login')
  }, [router, onLogout])

  // Called when user clicks "Stay logged in"
  const stayLoggedIn = useCallback(() => {
    logoutAtRef.current  = Date.now() + timeout
    isWarningRef.current = false
    if (onActive) onActive()
  }, [timeout, onActive])

  useEffect(() => {
    // Reset logout time on ANY user activity — including during warning
    const handleActivity = () => {
      logoutAtRef.current  = Date.now() + timeout
      isWarningRef.current = false  // dismiss warning on any activity
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'click']
    events.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }))

    // Single interval checks everything every second
    intervalRef.current = setInterval(() => {
      if (isLoggedOutRef.current) return

      const remaining = logoutAtRef.current - Date.now()

      if (remaining <= 0) {
        doLogout()
        return
      }

      if (remaining <= WARNING_BEFORE) {
        isWarningRef.current = true
        if (onWarning) onWarning(Math.ceil(remaining / 1000))
      } else {
        // Back to safe zone (stayLoggedIn was clicked)
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