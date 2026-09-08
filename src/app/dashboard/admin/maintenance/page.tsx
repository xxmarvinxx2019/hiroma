'use client'

import { useEffect, useState } from 'react'

interface MaintenanceState {
  enabled: boolean
  message: string
  startedAt: string | null
  updatedAt: string | null
  updatedBy: string | null
}

const DEFAULT_NOTICE = 'Hiroma is temporarily under maintenance while we safely deploy an update. Please try again later.'

export default function AdminMaintenancePage() {
  const [state, setState] = useState<MaintenanceState | null>(null)
  const [targetEnabled, setTargetEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(DEFAULT_NOTICE)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/admin/maintenance', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to read maintenance status.')
        return data as MaintenanceState
      })
      .then((data) => {
        if (!active) return
        setState(data)
        setTargetEnabled(data.enabled)
        setMessage(data.enabled ? data.message : DEFAULT_NOTICE)
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to read maintenance status.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const changeState = async () => {
    if (!state || targetEnabled === null || targetEnabled === state.enabled) return
    const nextEnabled = targetEnabled
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled, message, confirmation }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Maintenance mode was not changed.')
      setState(data.state)
      setTargetEnabled(nextEnabled)
      setConfirmation('')
      setSuccess(nextEnabled
        ? 'Maintenance protection is ON. Normal users and all non-recovery writes are now blocked.'
        : 'Maintenance protection is OFF. Normal operations have resumed.')
      if (!nextEnabled) setMessage(DEFAULT_NOTICE)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Maintenance mode was not changed.')
    } finally {
      setSaving(false)
    }
  }

  const changingState = Boolean(state && targetEnabled !== null && targetEnabled !== state.enabled)
  const requiredWord = targetEnabled ? 'MAINTENANCE' : 'RESUME'
  const canSubmit = Boolean(
    state && changingState &&
    confirmation.trim().toUpperCase() === requiredWord &&
    message.trim().length >= (targetEnabled ? 10 : 3) &&
    !saving,
  )

  const selectTargetState = (enabled: boolean) => {
    setTargetEnabled(enabled)
    setConfirmation('')
    setError('')
    setSuccess('')
    if (enabled && !state?.enabled) setMessage(DEFAULT_NOTICE)
    if (!enabled && state?.enabled) setMessage('Deployment completed successfully.')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a88427]">Owner-only control</p>
        <h1 className="mt-1 text-2xl font-bold text-[#0D1B3E]">Maintenance mode</h1>
        <p className="mt-1 text-sm text-gray-500">Pause new operational and financial activity before a production deployment.</p>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      <section className="overflow-hidden rounded-2xl border border-[#0D1B3E]/10 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#0D1B3E]/8 px-6 py-5">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Current production state</h2>
            <p className="mt-1 text-xs text-gray-400">This value is read directly from the protected database setting.</p>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${
            state?.enabled ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
          }`}>
            <span className={`h-2.5 w-2.5 rounded-full ${state?.enabled ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {loading ? 'CHECKING' : state?.enabled ? 'MAINTENANCE ON' : 'NORMAL OPERATIONS'}
          </div>
        </div>

        <div className="space-y-5 p-6">
          {state?.startedAt && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Maintenance started {new Date(state.startedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Philippine time).
            </p>
          )}

          <fieldset disabled={loading || saving || !state}>
            <legend className="text-xs font-semibold text-[#0D1B3E]">Choose the production state</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => selectTargetState(false)}
                aria-pressed={targetEnabled === false}
                className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  targetEnabled === false
                    ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/15'
                    : 'border-[#0D1B3E]/10 bg-white hover:border-emerald-300'
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-emerald-800">OFF</span>
                  <span className={`h-4 w-4 rounded-full border-4 ${targetEnabled === false ? 'border-emerald-500 bg-white' : 'border-gray-300'}`} />
                </span>
                <span className="mt-1 block text-xs text-gray-500">Normal operations are available.</span>
              </button>
              <button
                type="button"
                onClick={() => selectTargetState(true)}
                aria-pressed={targetEnabled === true}
                className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  targetEnabled === true
                    ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-500/15'
                    : 'border-[#0D1B3E]/10 bg-white hover:border-amber-300'
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-amber-800">ON</span>
                  <span className={`h-4 w-4 rounded-full border-4 ${targetEnabled === true ? 'border-amber-500 bg-white' : 'border-gray-300'}`} />
                </span>
                <span className="mt-1 block text-xs text-gray-500">Pause users and protected writes.</span>
              </button>
            </div>
          </fieldset>

          <div>
            <label htmlFor="maintenance-message" className="text-xs font-semibold text-[#0D1B3E]">
              {targetEnabled ? 'Public maintenance notice' : 'Completion note'}
            </label>
            <textarea
              id="maintenance-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              maxLength={500}
              disabled={loading || saving || !changingState}
              className="mt-2 w-full resize-none rounded-xl border border-[#0D1B3E]/15 px-4 py-3 text-sm text-[#0D1B3E] outline-none transition focus:border-[#C9A84C] focus:ring-2 focus:ring-[#C9A84C]/15 disabled:bg-gray-50"
            />
            <p className="mt-1 text-right text-[11px] text-gray-400">{message.length}/500</p>
          </div>

          <div>
            <label htmlFor="maintenance-confirmation" className="text-xs font-semibold text-[#0D1B3E]">
              Type <span className="font-mono text-[#a88427]">{requiredWord}</span> to confirm
            </label>
            <input
              id="maintenance-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              disabled={loading || saving || !changingState}
              className="mt-2 w-full rounded-xl border border-[#0D1B3E]/15 px-4 py-3 text-sm uppercase tracking-wider text-[#0D1B3E] outline-none transition focus:border-[#C9A84C] focus:ring-2 focus:ring-[#C9A84C]/15 disabled:bg-gray-50"
            />
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={changeState}
            className={`w-full rounded-xl px-5 py-3 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
              targetEnabled ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
          >
            {saving
              ? 'Applying protected change…'
              : !changingState
              ? 'Select the other state to make a change'
              : targetEnabled
              ? 'Turn ON maintenance protection'
              : 'Turn OFF and resume operations'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-[#0D1B3E]/10 bg-[#07102f] p-6 text-white">
        <h2 className="text-sm font-semibold">What is protected while ON</h2>
        <ul className="mt-4 grid gap-3 text-xs leading-5 text-white/65 md:grid-cols-2">
          <li>• Registration, upgrade, POS, sales, stock, PIN, payout, and commission writes return HTTP 503.</li>
          <li>• Reseller, distributor, branch, cashier, and staff sign-ins are paused.</li>
          <li>• The owner-admin recovery login, status page, logout, and this control remain available.</li>
          <li>• Every ON/OFF transition and reason is written atomically to the audit log.</li>
        </ul>
        <p className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-5 text-amber-200/80">
          Turn maintenance ON before migration or deployment, wait for any already-running request to finish, deploy and verify, then turn it OFF. This switch does not cancel a transaction that was already committed before activation.
        </p>
      </section>
    </div>
  )
}
