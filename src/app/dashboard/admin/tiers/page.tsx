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
  is_active: boolean
}

// ============================================================
// PAGE
// ============================================================

export default function TierSettingsPage() {
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Package>>({})
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)

  const fetchPackages = () => {
    setLoading(true)
    fetch('/api/admin/packages')
      .then((r) => r.json())
      .then((data) => setPackages(data.packages || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchPackages() }, [])

  const startEdit = (pkg: Package) => {
    setEditing(pkg.id)
    setForm({
      direct_referral_bonus: pkg.direct_referral_bonus,
      pairing_bonus_value: pkg.pairing_bonus_value,
      point_php_value: pkg.point_php_value,
      point_reset_days: pkg.point_reset_days,
    })
  }

  const cancelEdit = () => {
    setEditing(null)
    setForm({})
  }

  const handleSave = async (pkg: Package) => {
    setSaving(true)
    const res = await fetch(`/api/admin/packages/${pkg.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: pkg.name,
        price: pkg.price,
        direct_referral_bonus: Number(form.direct_referral_bonus),
        pairing_bonus_value: Number(form.pairing_bonus_value),
        point_php_value: Number(form.point_php_value),
        point_reset_days: Number(form.point_reset_days),
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
            { label: 'Direct referral bonus', desc: 'PHP earned when a reseller refers someone new using their link' },
            { label: 'Binary pairing bonus', desc: 'PHP earned when left & right legs form a matching pair' },
            { label: 'Point PHP value', desc: 'How much 1 sponsor pairing point is worth in PHP' },
            { label: 'Point reset days', desc: 'How many days before sponsor points are reset to zero' },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-lg p-3 border border-[#C9A84C]/20">
              <p className="text-xs font-medium text-[#0D1B3E] mb-1">{item.label}</p>
              <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
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
            <div
              key={pkg.id}
              className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden"
            >
              {/* Package Header */}
              <div className="bg-[#0D1B3E] px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-white font-semibold text-sm">{pkg.name}</h3>
                  <span className="text-[#C9A84C] text-xs">
                    ₱{Number(pkg.price).toLocaleString()} package
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    pkg.is_active
                      ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                      : 'bg-[#fdecea] text-[#a03030]'
                  }`}>
                    {pkg.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex gap-2">
                  {editing === pkg.id ? (
                    <>
                      <button
                        onClick={cancelEdit}
                        className="text-xs text-white/50 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSave(pkg)}
                        disabled={saving}
                        className="text-xs bg-[#C9A84C] text-[#0D1B3E] font-semibold px-3 py-1 rounded-lg hover:bg-[#E8C96A] transition-colors disabled:opacity-60"
                      >
                        {saving ? 'Saving...' : 'Save changes'}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => startEdit(pkg)}
                      className="text-xs text-[#C9A84C] hover:text-[#E8C96A] transition-colors font-medium"
                    >
                      Edit values
                    </button>
                  )}
                </div>
              </div>

              {/* Saved success indicator */}
              {savedId === pkg.id && (
                <div className="bg-[#e8f7ef] px-5 py-2">
                  <p className="text-xs text-[#1a7a4a] font-medium">✓ Tier values updated successfully!</p>
                </div>
              )}

              {/* Values Grid */}
              <div className="p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

                  {/* Direct referral bonus */}
                  <div className="bg-[#F0F2F8] rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Direct referral bonus</p>
                    {editing === pkg.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">₱</span>
                        <input
                          type="number"
                          value={form.direct_referral_bonus || ''}
                          onChange={(e) => setForm({ ...form, direct_referral_bonus: Number(e.target.value) })}
                          className="flex-1 bg-white border border-[#C9A84C] rounded px-2 py-1 text-sm font-semibold text-[#0D1B3E] outline-none w-full"
                        />
                      </div>
                    ) : (
                      <p className="text-xl font-semibold text-[#C9A84C]">
                        ₱{Number(pkg.direct_referral_bonus).toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">per referral</p>
                  </div>

                  {/* Binary pairing bonus */}
                  <div className="bg-[#F0F2F8] rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Binary pairing bonus</p>
                    {editing === pkg.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">₱</span>
                        <input
                          type="number"
                          value={form.pairing_bonus_value || ''}
                          onChange={(e) => setForm({ ...form, pairing_bonus_value: Number(e.target.value) })}
                          className="flex-1 bg-white border border-[#C9A84C] rounded px-2 py-1 text-sm font-semibold text-[#0D1B3E] outline-none w-full"
                        />
                      </div>
                    ) : (
                      <p className="text-xl font-semibold text-[#C9A84C]">
                        ₱{Number(pkg.pairing_bonus_value).toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">per pair</p>
                  </div>

                  {/* Point PHP value */}
                  <div className="bg-[#F0F2F8] rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Point PHP value</p>
                    {editing === pkg.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">₱</span>
                        <input
                          type="number"
                          value={form.point_php_value || ''}
                          onChange={(e) => setForm({ ...form, point_php_value: Number(e.target.value) })}
                          className="flex-1 bg-white border border-[#C9A84C] rounded px-2 py-1 text-sm font-semibold text-[#0D1B3E] outline-none w-full"
                        />
                      </div>
                    ) : (
                      <p className="text-xl font-semibold text-[#C9A84C]">
                        ₱{Number(pkg.point_php_value).toLocaleString()}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">per point</p>
                  </div>

                  {/* Point reset days */}
                  <div className="bg-[#F0F2F8] rounded-lg p-4">
                    <p className="text-xs text-gray-400 mb-2">Point reset period</p>
                    {editing === pkg.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={form.point_reset_days || ''}
                          onChange={(e) => setForm({ ...form, point_reset_days: Number(e.target.value) })}
                          className="flex-1 bg-white border border-[#C9A84C] rounded px-2 py-1 text-sm font-semibold text-[#0D1B3E] outline-none w-full"
                        />
                        <span className="text-xs text-gray-400">days</span>
                      </div>
                    ) : (
                      <p className="text-xl font-semibold text-[#0D1B3E]">
                        {pkg.point_reset_days}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">days per reset</p>
                  </div>

                </div>

                {/* Daily caps reminder */}
                <div className="mt-4 pt-4 border-t border-[#0D1B3E]/5">
                  <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">System rules (applies to all tiers)</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Daily referral cap', value: '10 / day → overflow to Hiroma' },
                      { label: 'Daily pairs cap', value: '12 / day → overflow to Hiroma' },
                      { label: 'Name cap', value: 'Max 7 accounts per name' },
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