'use client'

export type PendingFinancialOperation = { kind: 'registration' | 'upgrade'; sourceId: string }
const storageKey = 'hiroma-pending-financial-operations-v1'
const changedEvent = 'hiroma-financial-operations-changed'
export function pendingFinancialOperations(): PendingFinancialOperation[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return Array.isArray(parsed) ? parsed.filter(item => item && ['registration', 'upgrade'].includes(item.kind) && typeof item.sourceId === 'string' && item.sourceId.length <= 255).slice(-50).map(item => ({ kind: item.kind, sourceId: item.sourceId })) : []
  } catch { return [] }
}
export function rememberFinancialOperation(operation: PendingFinancialOperation, remove = false) {
  try {
    const remaining = pendingFinancialOperations().filter(item => item.kind !== operation.kind || item.sourceId !== operation.sourceId)
    localStorage.setItem(storageKey, JSON.stringify(remove ? remaining : [...remaining, operation].slice(-50)))
    window.dispatchEvent(new Event(changedEvent))
  } catch {
    if (!remove) throw new Error('Unable to save the recovery reference on this device. Allow browser storage before submitting.')
  }
}
export function financialRecoveryUrl(operation: PendingFinancialOperation) {
  return `/api/city/financial-operations?${new URLSearchParams({ kind: operation.kind, source_id: operation.sourceId })}`
}

async function boundedFetch(url: string, init: RequestInit, timeout: number) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeout)
  try { return await fetch(url, { ...init, signal: controller.signal }) }
  finally { window.clearTimeout(timer) }
}

// Persist only the original PIN UUID and operation type; never passwords, PIN codes or applicant details.
export async function recoverableFinancialFetch(url: string, init: RequestInit): Promise<Response> {
  if (typeof init.body !== 'string') throw new Error('A JSON financial request is required.')
  const body = JSON.parse(init.body)
  const operation: PendingFinancialOperation = url.endsWith('/upgrade') ? { kind: 'upgrade', sourceId: body.new_pin_id } : { kind: 'registration', sourceId: body.pin_id }
  if (typeof operation.sourceId !== 'string' || !operation.sourceId) throw new Error('Verify the original PIN before submitting.')
  rememberFinancialOperation(operation)
  let original: Response | undefined
  try {
    original = await boundedFetch(url, init, 30000)
    if (original.ok) {
      // An empty/truncated success response remains uncertain until the receipt can be read.
      const result = await original.clone().json()
      if (result.success === true && typeof result.operation_reference === 'string') {
        window.dispatchEvent(new Event(changedEvent))
        return original
      }
    }
  } catch { /* The write may have committed; check instead of issuing another mutation. */ }
  try {
    const status = await boundedFetch(financialRecoveryUrl(operation), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: init.body, cache: 'no-store' }, 10000)
    const recovery = await status.json()
    if (status.ok && recovery.state === 'completed') {
      window.dispatchEvent(new Event(changedEvent))
      return new Response(JSON.stringify({ ...recovery.result, recovered: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (original && original.status >= 400 && original.status < 500 && original.status !== 408 && original.status !== 429 && status.ok && recovery.state === 'not_confirmed') {
      rememberFinancialOperation(operation, true)
      return original
    }
    if (original && original.status >= 400 && original.status < 500) return original
  } catch { /* Preserve the reminder when status cannot be confirmed. */ }
  throw new Error('The original transaction could not be confirmed. Do not use a new PIN. Check transaction recovery, or retry the same unchanged PIN transaction when the connection returns.')
}

export const financialOperationChangedEvent = changedEvent
