'use client'

import { useEffect, useState } from 'react'
import { financialOperationChangedEvent, financialRecoveryUrl, pendingFinancialOperations, rememberFinancialOperation, type PendingFinancialOperation } from '@/app/lib/recoverableFinancialRequest'
type Recovery = { operation: PendingFinancialOperation; message: string; reference?: string }
export default function FinancialOperationRecovery() {
  const [results, setResults] = useState<Recovery[]>([])
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const changed = () => setRevision(value => value + 1)
    window.addEventListener(financialOperationChangedEvent, changed)
    window.addEventListener('online', changed)
    window.addEventListener('storage', changed)
    return () => { window.removeEventListener(financialOperationChangedEvent, changed); window.removeEventListener('online', changed); window.removeEventListener('storage', changed) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    Promise.all(pendingFinancialOperations().map(async operation => {
      try {
        const response = await fetch(financialRecoveryUrl(operation), { cache: 'no-store', signal: controller.signal })
        const data = await response.json()
        if (response.ok && data.state === 'completed') return { operation, reference: data.result.operation_reference as string, message: `${operation.kind === 'registration' ? 'Registration' : 'Upgrade'} completed. ${data.result.reseller?.username ? `Username: ${data.result.reseller.username}.` : data.result.message || ''} Do not submit it again.` }
        return { operation, message: data.message || data.error || 'Original result not confirmed. Check again before using a different PIN.' }
      } catch { return { operation, message: 'Connection unavailable. Keep this reference and check again; do not use a different PIN.' } }
    })).then(rows => { if (!controller.signal.aborted) setResults(rows) })
    return () => controller.abort()
  }, [revision])
  if (!results.length) return null
  return <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm" aria-label="Transaction recovery"><div className="flex items-center justify-between gap-3"><strong>Interrupted transaction recovery</strong><button type="button" onClick={() => setRevision(value => value + 1)} className="rounded border bg-white px-3 py-1 text-xs">Check again</button></div>{results.map(row => <div key={`${row.operation.kind}:${row.operation.sourceId}`} className="mt-3 space-y-1"><p>{row.message}</p><p className="break-all text-xs text-gray-600">{row.reference || `${row.operation.kind}:${row.operation.sourceId}`}</p>{row.reference && <button type="button" onClick={() => rememberFinancialOperation(row.operation, true)} className="text-xs underline">Acknowledge completed transaction</button>}</div>)}</section>
}
