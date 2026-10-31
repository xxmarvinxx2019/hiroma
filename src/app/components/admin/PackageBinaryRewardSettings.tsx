'use client'

import { useEffect, useState } from 'react'
import PasswordInput from '@/app/components/ui/PasswordInput'
import { readSettingsResponse } from '@/app/lib/settingsResponse'
import ProductRewardsHistory from '@/app/components/rewards/ProductRewardsHistory'

export default function PackageBinaryRewardSettings() {
  const [enabled, setEnabled] = useState(false)
  const [savedEnabled, setSavedEnabled] = useState(false)
  const [savedOptions, setSavedOptions] = useState<{ interval: number; product_id: string | null }>({ interval: 5, product_id: null })
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [interval, setInterval] = useState('5')
  const [productId, setProductId] = useState('')
  const [products, setProducts] = useState<{ id: string; name: string; cost_price: string }[]>([])
  const [summary, setSummary] = useState({ bottles: 0, company_cost: 0 })
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    fetch('/api/admin/settings/package-binary-reward', { cache: 'no-store' }).then(async response => {
      const data = await readSettingsResponse<{
        policy: { enabled: boolean; interval: number; product_id: string | null }
        products: typeof products; summary: typeof summary
      }>(response, 'Unable to load product reward policy.')
      setEnabled(data.policy.enabled); setInterval(String(data.policy.interval)); setProductId(data.policy.product_id || '')
      setSavedEnabled(data.policy.enabled)
      setSavedOptions({ interval: data.policy.interval, product_id: data.policy.product_id })
      setProducts(data.products); setSummary(data.summary)
      setReady(true)
    }).catch(error => setError(error.message)).finally(() => setLoading(false))
  }, [])

  const controlsDisabled = loading || !ready || saving || !enabled || confirmDisable

  function toggleEnabled(checked: boolean) {
    setError(''); setMessage(''); setPin('')
    if (!checked && savedEnabled) {
      setConfirmDisable(true)
      return
    }
    setEnabled(checked)
  }

  async function save(targetEnabled = enabled) {
    if (loading || !ready || saving || pin.length !== 6 || (targetEnabled && (!enabled || !productId)) || (!targetEnabled && !confirmDisable)) return
    setSaving(true); setError(''); setMessage('')
    try {
      const options = targetEnabled ? { interval: Number(interval), product_id: productId || null } : savedOptions
      const response = await fetch('/api/admin/settings/package-binary-reward', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: { enabled: targetEnabled, ...options }, security_pin: pin }),
      })
      await readSettingsResponse(response, 'Unable to save product reward policy.')
      setEnabled(targetEnabled); setSavedEnabled(targetEnabled); setConfirmDisable(false)
      setSavedOptions(options); setInterval(String(options.interval)); setProductId(options.product_id || '')
      setPin(''); setMessage(targetEnabled ? 'Saved. This rule applies to future eligible Package Binary pairs.' : 'Product rewards disabled. Eligible pairs now earn cash; earned bottles are preserved.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save policy.') }
    finally { setSaving(false) }
  }

  return <><section className="overflow-hidden rounded-xl border border-[#0D1B3E]/8 bg-white">
    <div className="border-b border-[#0D1B3E]/8 px-5 py-4">
      <h2 className="text-sm font-semibold text-[#0D1B3E]">Package Binary product rewards</h2>
      <p className="mt-0.5 text-xs text-gray-400">Replace every Nth eligible pair’s cash commission with one bottle</p>
    </div>
    <div className="space-y-4 p-5">
      <label className="flex items-center gap-2 text-sm text-[#0D1B3E]"><input type="checkbox" checked={enabled} onChange={e => toggleEnabled(e.target.checked)} disabled={loading || !ready || saving || confirmDisable} />Enable product rewards</label>
      <p className="text-xs text-gray-500">When enabled and saved, every Nth eligible pair earns one bottle instead of cash. When disabled, eligible pairs continue earning cash.</p>
      {!enabled && ready && <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">Check “Enable product rewards” to unlock the options below.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-500">One bottle every N eligible pairs
          <input type="number" min={2} max={1000} step={1} value={interval} onChange={e => setInterval(e.target.value)} disabled={controlsDisabled} className="mt-1 w-full rounded-lg border bg-[#F0F2F8] px-3 py-2 text-sm text-[#0D1B3E] disabled:cursor-not-allowed disabled:opacity-50" />
        </label>
        <label className="text-xs text-gray-500">Reward bottle
          <select value={productId} onChange={e => setProductId(e.target.value)} disabled={controlsDisabled} className="mt-1 w-full rounded-lg border bg-[#F0F2F8] px-3 py-2 text-sm text-[#0D1B3E] disabled:cursor-not-allowed disabled:opacity-50">
            <option value="">{loading ? 'Loading bottles…' : !ready ? 'Complete database setup first' : products.length ? 'Select one bottle' : 'No active bottles with company cost'}</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} — company cost ₱{Number(p.cost_price).toFixed(2)}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs leading-5 text-gray-500">Only active members’ pairs within the daily cap count. Both cash and product pairs use the cap. The counter continues across days, registrations and upgrades. At 5, pairs 5, 10, 15 earn one bottle each; at 6, future pair numbers divisible by 6 earn a bottle. Changing this setting preserves the counter and all earned bottles. Disabled periods do not advance the counter. Historical pairs before activation are excluded.</p>
      <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Product rewards are bottles, not cash. No withdrawal or additional binary PU is generated. Earned bottle credits: {summary.bottles.toLocaleString()} · recorded company cost: ₱{Number(summary.company_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}. Branch/city POS records claims and deducts stock; claim details appear in the history below.</p>
      <label className="block max-w-xs text-xs text-gray-500">Admin Security PIN
        <PasswordInput type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={controlsDisabled} placeholder="6-digit PIN" className="mt-1 w-full rounded-lg border bg-[#F0F2F8] px-3 py-2 text-sm text-[#0D1B3E] disabled:cursor-not-allowed disabled:opacity-50" />
      </label>
      {error && !confirmDisable && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {message && <p role="status" className="text-xs text-emerald-700">{message}</p>}
      <button type="button" onClick={() => void save()} disabled={controlsDisabled || pin.length !== 6 || !productId} className="rounded-lg bg-[#0D1B3E] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Saving…' : 'Save product reward policy'}</button>
      {confirmDisable && <div role="dialog" aria-modal="true" aria-labelledby="disable-product-rewards-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
          <h3 id="disable-product-rewards-title" className="font-semibold text-[#0D1B3E]">Turn off product rewards?</h3>
          <p className="text-sm text-gray-600">Future eligible pairs will earn cash. Previously earned bottles will be preserved.</p>
          <label className="block text-xs text-gray-500">Admin Security PIN
            <PasswordInput autoFocus type="password" inputMode="numeric" maxLength={6} value={pin} disabled={saving} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit PIN" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
          </label>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" disabled={saving} onClick={() => { setConfirmDisable(false); setPin(''); setError('') }} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
            <button type="button" disabled={saving || pin.length !== 6} onClick={() => void save(false)} className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Saving…' : 'Turn off rewards'}</button>
          </div>
        </div>
      </div>}
    </div>
  </section>
    {ready && <ProductRewardsHistory admin />}
  </>
}
