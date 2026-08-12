'use client'

import { useEffect, useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'

type Device = { id: string; name: string; created_at: string; last_used_at: string | null; backed_up: boolean }

export default function PasskeySettings() {
  const [eligible, setEligible] = useState(false)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceName, setDeviceName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    const response = await fetch('/api/reseller/passkeys', { cache: 'no-store' })
    const data = await response.json()
    if (response.ok) { setEligible(Boolean(data.eligible)); setDevices(data.devices || []) }
  }
  useEffect(() => {
    let active = true
    void fetch('/api/reseller/passkeys', { cache: 'no-store' })
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (active && ok) { setEligible(Boolean(data.eligible)); setDevices(data.devices || []) }
      })
    return () => { active = false }
  }, [])
  if (!eligible) return null

  const register = async () => {
    if (!deviceName.trim() || !password) return setMessage('Enter a device name and your current password.')
    setBusy(true); setMessage('')
    try {
      const start = await fetch('/api/auth/passkey/register/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_name: deviceName, password }) })
      const options = await start.json()
      if (!start.ok) throw new Error(options.error || 'Unable to start registration.')
      const credential = await startRegistration({ optionsJSON: options })
      const finish = await fetch('/api/auth/passkey/register/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credential) })
      const result = await finish.json()
      if (!finish.ok) throw new Error(result.error || 'Unable to verify passkey.')
      setDeviceName(''); setPassword(''); setMessage('Passkey added. Face ID, fingerprint, or device unlock can now sign you in.'); await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Passkey registration was cancelled.') }
    finally { setBusy(false) }
  }

  const remove = async (device: Device) => {
    const currentPassword = window.prompt('Enter your current password to remove ' + device.name + ':')
    if (!currentPassword) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/reseller/passkeys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: device.id, password: currentPassword }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to remove passkey.')
      setMessage(result.message); await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to remove passkey.') }
    finally { setBusy(false) }
  }

  return <section className="overflow-hidden rounded-xl border border-[#0D1B3E]/8 bg-white">
    <div className="border-b border-[#0D1B3E]/8 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-[#0D1B3E]">Face ID / Fingerprint Login</h2>
        <span className="rounded-full bg-[#F0F2F8] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">Powered by passkeys</span>
      </div>
      <p className="mt-1 text-xs text-gray-400">Register this device for secure Face ID, fingerprint, or device-unlock sign-in. Your password remains available for recovery.</p>
    </div>
    <div className="space-y-4 p-5">
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={deviceName} onChange={event => setDeviceName(event.target.value)} maxLength={60} placeholder="Device name (for example, My iPhone)" className="rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-sm" />
        <input value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="Current password" className="rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-sm" />
      </div>
      <button type="button" disabled={busy} onClick={register} className="rounded-lg bg-[#0D1B3E] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Working...' : 'Register this device'}</button>
      {message && <p className="rounded-lg bg-[#F0F2F8] px-3 py-2 text-xs text-[#0D1B3E]">{message}</p>}
      <div className="space-y-2">
        {devices.map(device => <div key={device.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#0D1B3E]/10 px-3 py-3"><div><p className="text-sm font-medium text-[#0D1B3E]">{device.name}</p><p className="text-xs text-gray-400">Added {new Date(device.created_at).toLocaleDateString()} {' / '} {device.last_used_at ? 'Last used ' + new Date(device.last_used_at).toLocaleDateString() : 'Not used yet'}{device.backed_up ? ' / Synced' : ''}</p></div><button type="button" disabled={busy} onClick={() => remove(device)} className="text-xs font-medium text-red-600 hover:underline">Remove</button></div>)}
        {!devices.length && <p className="text-xs text-gray-400">No passkeys registered yet. You can add more than one device.</p>}
      </div>
    </div>
  </section>
}
