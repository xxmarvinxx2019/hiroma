'use client'

export async function retryableRequest(url: string, init: RequestInit) {
  if (typeof init.body !== 'string') throw new Error('A JSON request is required.')
  const payload = JSON.parse(init.body)
  delete payload.security_pin
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const storageKey = 'hiroma-request:' + url + ':' + fingerprint
  const id = sessionStorage.getItem(storageKey) || crypto.randomUUID()
  sessionStorage.setItem(storageKey, id)
  const headers = new Headers(init.headers)
  headers.set('Idempotency-Key', id)
  const response = await fetch(url, { ...init, headers })
  if (response.ok) {
    const result = await response.clone().json()
    if (result.success === true && sessionStorage.getItem(storageKey) === id) sessionStorage.removeItem(storageKey)
  }
  return response
}
