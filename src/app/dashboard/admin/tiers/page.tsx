'use client'

import { useState, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

interface Package {
  id: string
  name: string
  price: number
  direct_referral_bonus: number
  pairing_bonus_value: number
  point_php_value: number
  point_reset_days: number
  daily_product_pairing_cap: number
  is_active: boolean
}

interface PuResetSettings {
  pu_reset_month: string
  pu_reset_day:   string
}

const MONTHS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' },
  { value: '3', label: 'March' },   { value: '4', label: 'April' },
  { value: '5', label: 'May' },     { value: '6', label: 'June' },
  { value: '7', label: 'July' },    { value: '8', label: 'August' },
  { value: '9', label: 'September' },{ value: '10', label: 'October' },
  { value: '11', label: 'November' },{ value: '12', label: 'December' },
]

// ============================================================
// PAGE
// ============================================================

export default function TierSettingsPage() {
  const [packages, setPackages]   = useState<Package[]>([])
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState<string | null>(null)
  const [form, setForm]           = useState<Partial<Package & { daily_product_pairing_cap: number }>>({})
  const [saving, setSaving]       = useState(false)
  const [savedId, setSavedId]     = useState<string | null>(null)

  // PU Reset Settings
  const [puReset, setPuReset]         = useState<PuResetSettings>({ pu_reset_month: '3', pu_reset_day: '1' })
  const [puResetSaving, setPuResetSaving] = useState(false)
  const [puResetSaved, setPuResetSaved]   = useState(false)

  const fetchPackages = () => {
    setLoading(true)
    fetch('/api/admin/packages')
      .then((r) => r.json())
      .then((data) => setPackages(data.packages || []))
      .finally(() => setLoading(false))
  }

  const fetchPuReset = () => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data.pu_reset_month) setPuReset({
          pu_reset_month: data.pu_reset_month,
          pu_reset_day:   data.pu_reset_day || '1',
        })
      })
  }

  useEffect(() => { fetchPackages(); fetchPuReset() }, [])

  const startEdit = (pkg: Package) => {
    setEditing(pkg.id)
    setForm({
      direct_referral_bonus:     pkg.direct_referral_bonus,
      pairing_bonus_value:       pkg.pairing_bonus_value,
      point_php_value:           pkg.point_php_value,
      point_reset_days:          pkg.point_reset_days,
      daily_product_pairing_cap: pkg.daily_product_pairing_cap || 50,
    })
  }

  const cancelEdit = () => { setEditing(null); setForm({}) }

  const handleSave = async (pkg: Package) => {
    setSaving(true)
    const res = await fetch(`/api/admin/packages/${pkg.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:                      pkg.name,
        price:                     pkg.price,
        direct_referral_bonus:     Number(form.direct_referral_bonus),
        pairing_bonus_value:       Number(form.pairing_bonus_value),
        point_php_value:           Number(form.point_php_value),
        point_reset_days:          Number(form.point_reset_days),
        daily_product_pairing_cap: Number(form.daily_product_pairing_cap),
        products: [],
      }),
    })
    if (res.ok) {
      setSavedId(pkg.id)
      fetchPackages()
      setEditing(null)
      setTimeout(() => setSavedId(null), 2000)
    }
    setSaving(false)
  }

  const handleSavePuReset = async () => {
    setPuResetSaving(true)
    const res = await fetch('/api/admin/settings', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pu_reset_month: puReset.pu_reset_month,
        pu_reset_day:   puReset.pu_reset_day,
      }),
    })
    if (res.ok) {
      setPuResetSaved(true)
      setTimeout(() => setPuResetSaved(false), 2000)
    }
    setPuResetSaving(false)
  }

  // Compute days in selected month
  const daysInMonth = new Date(2024, parseInt(puReset.pu_reset_month), 0).getDate()

  return (
    <div className="max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Tier settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Configure bonus values and point settings per package tier
        </p>
      </div>

      {/* Info Banner */}
      <div className="bg-[#fef9ee] border border-[#C9A84C]/30 rounded-xl p-4 mb-6">
        <p className="text-xs font-medium text-[#9a6f1e] mb-1">How tier settings work</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
          {[
            { label: 'Direct referral bonus',      desc: 'PHP earned when a reseller refers someone new using their link' },
            { label: 'Binary pairing bonus',       desc: 'PHP earned when left & right legs form a matching pair' },
            { label: 'Point PHP value',            desc: 'How much 1 product pairing point is worth in PHP' },
            { label: 'Daily product pairing cap',  desc: 'Max product binary pairs per day before overflow to Hiroma' },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-lg p-3 border border-[#C9A84C]/20">
              <p className="text-xs font-medium text-[#0D1B3E] mb-1">{item.label}</p>
              <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── PU Reset Date (Global) ── */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden mb-6">
        <div className="bg-[#010521] px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-white font-semibold text-sm">Product Points Reset Date</h3>
            <span className="text-[#C9A84C] text-xs">Global — applies to all resellers</span>
          </div>
          <button
            onClick={handleSavePuReset}
            disabled={puResetSaving}
            className="text-xs bg-[#C9A84C] text-[#0D1B3E] font-semibold px-3 py-1 rounded-lg hover:bg-[#E8C96A] transition-colors disabled:opacity-60"
          >
            {puResetSaving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {puResetSaved && (
          <div className="bg-[#e8f7ef] px-5 py-2">
            <p className="text-xs text-[#1a7a4a] font-medium">✓ PU reset date updated successfully!</p>
          </div>
        )}

        <div className="p-5">
          <p className="text-xs text-gray-400 mb-4">
            All reseller product points (PU) will reset on this date every year. Points accumulated before this date will expire.
          </p>
          <div className="flex items-center gap-4">
            <div className="bg-[#F0F2F8] rounded-lg p-4 flex-1">
              <p className="text-xs text-gray-400 mb-2">Reset Month</p>
              <select
                value={puReset.pu_reset_month}
                onChange={(e) => setPuReset({ ...puReset, pu_reset_month: e.target.value, pu_reset_day: '1' })}
                className="w-full bg-white border border-[#C9A84C] rounded px-2 py-1.5 text-sm font-semibold text-[#0D1B3E] outline-none"
              >
                {MONTHS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="bg-[#F0F2F8] rounded-lg p-4 flex-1">
              <p className="text-xs text-gray-400 mb-2">Reset Day</p>
              <select
                value={puReset.pu_reset_day}
                onChange={(e) => setPuReset({ ...puReset, pu_reset_day: e.target.value })}
                className="w-full bg-white border border-[#C9A84C] rounded px-2 py-1.5 text-sm font-semibold text-[#0D1B3E] outline-none"
              >
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => (
                  <option key={d} value={String(d)}>{d}</option>
                ))}
              </select>
            </div>
            <div className="bg-[#fef9ee] border border-[#C9A84C]/30 rounded-lg p-4 flex-1">
              <p className="text-xs text-gray-400 mb-1">Current Setting</p>
              <p className="text-sm font-semibold text-[#9a6f1e]">
                {MONTHS.find(m => m.value === puReset.pu_reset_month)?.label} {puReset.pu_reset_day}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">Resets every year on this date</p>
            </div>
          </div>
        </div>
      </div>

      {/* Package Tier Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : packages.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-12 text-center">
          <p className="text-gray-400 text-sm mb-2">No packages found</p>
          <a href="/dashboard/admin/packages" className="text-xs text-[#C9A84C] hover:underline">
            Create packages first →
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {packages.map((pkg) => (
            <div key={pkg.id} className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
              {/* Package Header */}
              <div className="bg-[#010521] px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-white font-semibold text-sm">{pkg.name}</h3>
                  <span className="text-[#C9A84C] text-xs">₱{Number(pkg.price).toLocaleString()} package</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${pkg.is_active ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fdecea] text-[#a03030]'}`}>
                    {pkg.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex gap-2">
                  {editing === pkg.id ? (
                    <>
                      <button onClick={cancelEdit} className="text-xs text-white/50 hover:text-white transition-colors">
                        Cancel
                      </button>
                      <button onClick={() => handleSave(pkg)} disabled={saving}
                        className="text-xs bg-[#C9A84C] text-[#0D1B3E] font-semibold px-3 py-1 rounded-lg hover:bg-[#E8C96A] transition-colors disabled:opacity-60">
                        {saving ? 'Saving...' : 'Save changes'}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => startEdit(pkg)}
                      className="text-xs text-[#C9A84C] hover:text-[#E8C96A] transition-colors font-medium">
                      Edit values
                    </button>
                  )}
                </div>
              </div>

              {savedId === pkg.id && (
                <div className="bg-[#e8f7ef] px-5 py-2">
                  <p className="text-xs text-[#1a7a4a] font-medium">✓ Tier values updated successfully!</p>
                </div>
              )}

              {/* Values Grid */}
              <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">

                  {/* Direct referral bonus */}
                  <div className="bg-[#F0F2F8] rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Direct referral bonus</p>
                    {editing === pkg.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">₱</span>
                        <input type="number" value={form.direct_referral_bonus || ''}
                          onChange={(e) => setForm({ ...form, direct_referral_bonus: Number(e.target.value) })}
                          className="flex-1 bg-white border border-[#C9A84C] rounded px-2 py-1 text-sm font-semibold text-[#0D1B3E] outline-none w-full" />
                      </div>
                    ) : (
                      <p className="text-xl font-semibold text-[#C9A84C]">₱{Number(pkg.direct_referral_bonus).toLocaleString()}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">per referral</p>
                  </div>

                  {/* Binary pairing bonus */}
                  <div className="bg-[#F0F2F8] rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Binary pairing bonus</p>
                    {editing === pkg.id ? (
                      <div className="flex items-center gap-1">
                        <input type="number" value={form.pairing_bonus_value || ''}
                          onChange={(e) => setForm({ ...form, pairing_bonus_value: Number(e.target.value) })}
                          className="flex-1 bg-white border border-[#C9A84C] rounded px-2 py-1 text-sm font-semibold text-[#0D1B3E] outline-none w-full" />
                        <span className="text-xs text-gray-400">pts</span>
                      </div>
                    ) : (
                      <p className="text-xl font-semibold text-[#C9A84C]">{Number(pkg.pairing_bonus_value).toLocaleString()}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">pts per pair</p>
                  </div>

                  {/* Point PHP value */}
                  <div className="bg-[#F0F2F8] rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Product point value</p>
                    {editing === pkg.id ? (
                      <div className="flex items-center gap-1">
                        <input type="number" value={form.point_php_value || ''}
                          onChange={(e) => setForm({ ...form, point_php_value: Number(e.target.value) })}
                          className="flex-1 bg-white border border-[#C9A84C] rounded px-2 py-1 text-sm font-semibold text-[#0D1B3E] outline-none w-full" />
                        <span className="text-xs text-gray-400">pts</span>
                      </div>
                    ) : (
                      <p className="text-xl font-semibold text-[#C9A84C]">{Number(pkg.point_php_value).toLocaleString()}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">pts per reorder</p>
                  </div>

                  {/* Point reset days */}
                  <div className="bg-[#F0F2F8] rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Point reset period</p>
                    {editing === pkg.id ? (
                      <div className="flex items-center gap-1">
                        <input type="number" value={form.point_reset_days || ''}
                          onChange={(e) => setForm({ ...form, point_reset_days: Number(e.target.value) })}
                          className="flex-1 bg-white border border-[#C9A84C] rounded px-2 py-1 text-sm font-semibold text-[#0D1B3E] outline-none w-full" />
                        <span className="text-xs text-gray-400">days</span>
                      </div>
                    ) : (
                      <p className="text-xl font-semibold text-[#0D1B3E]">{pkg.point_reset_days}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">days per reset</p>
                  </div>

                  {/* Daily product pairing cap */}
                  <div className="bg-[#F0F2F8] rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Daily product pair cap</p>
                    {editing === pkg.id ? (
                      <div className="flex items-center gap-1">
                        <input type="number" value={form.daily_product_pairing_cap || ''}
                          onChange={(e) => setForm({ ...form, daily_product_pairing_cap: Number(e.target.value) })}
                          className="flex-1 bg-white border border-[#C9A84C] rounded px-2 py-1 text-sm font-semibold text-[#0D1B3E] outline-none w-full" />
                        <span className="text-xs text-gray-400">/day</span>
                      </div>
                    ) : (
                      <p className="text-xl font-semibold text-[#0D1B3E]">{pkg.daily_product_pairing_cap || 50}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">pairs per day</p>
                  </div>

                </div>

                {/* System rules */}
                <div className="mt-4 pt-4 border-t border-[#0D1B3E]/5">
                  <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">System rules (applies to all tiers)</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Daily referral cap',  value: '10 / day → overflow to Hiroma' },
                      { label: 'Daily pairs cap',     value: '10 / day → overflow to Hiroma' },
                      { label: 'Name cap',            value: 'Max 7 accounts per name' },
                      { label: 'PU reset',            value: `Every ${MONTHS.find(m => m.value === puReset.pu_reset_month)?.label} ${puReset.pu_reset_day}` },
                    ].map((rule) => (
                      <div key={rule.label} className="bg-[#eef0f8] rounded-lg px-3 py-2">
                        <span className="text-xs text-[#0D1B3E] font-medium">{rule.label}: </span>
                        <span className="text-xs text-gray-400">{rule.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}