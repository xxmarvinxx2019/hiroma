'use client'

import { useEffect, useState, type FormEvent } from 'react'

const endpoint = '/api/admin/settings/product-binary-match'

export default function ProductBinaryMatchSettings() {
  const [current, setCurrent] = useState<number>()
  const [threshold, setThreshold] = useState('')
  const [amount, setAmount] = useState('')
  const [currentAmount, setCurrentAmount] = useState(5)
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(endpoint, { cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setCurrent(data.puPerLeg)
      setThreshold(String(data.puPerLeg))
      setAmount(String(data.pairAmount))
      setCurrentAmount(data.pairAmount)
    }).catch(() => setMessage('Unable to load the matching rule.'))
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ puPerLeg: Number(threshold), pairAmount: Number(amount), securityPin: pin }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setCurrent(data.puPerLeg)
      setCurrentAmount(data.pairAmount)
      setPin('')
      setMessage('Matching rule saved.')
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : 'Unable to save the matching rule.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 text-sm text-[#0D1B3E]">
    <h2 className="font-bold">Product Binary matching rule</h2>
    {current !== undefined && <form onSubmit={save} className="mt-3 space-y-3">
      <p>Current rule: {current} PU left + {current} PU right = 1 pair.</p>
      <p className="text-gray-600">Changes apply to future settlements, including existing unmatched PU used in those settlements.</p>
      <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
        <label>PU required per leg<input className="mt-1 block w-full rounded border p-2" type="number" required min={1} max={2147483647} step={1} value={threshold} onChange={e => setThreshold(e.target.value)} /></label>
        <label>Fixed payout per qualified pair (₱)<input className="mt-1 block w-full rounded border p-2" type="number" required min={0.5} max={20} step={0.5} value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label>Admin Security PIN<input className="mt-1 block w-full rounded border p-2" type="password" autoComplete="off" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></label>
      </fieldset>
      <button disabled={saving || (Number(threshold) === current && Number(amount) === currentAmount) || !/^\d{6}$/.test(pin)} className="rounded bg-[#0D1B3E] px-4 py-2 text-white disabled:opacity-40">
        {saving ? 'Saving…' : 'Save matching rule'}
      </button>
    </form>}
    <p role="status" className="mt-2">{message}</p>
  </section>
}
