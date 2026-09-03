'use client'

import { useState, useEffect } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface Product {
  id: string
  name: string
  price: number
  reseller_price: number
  type: string
}

interface PackageProduct {
  product_id: string
  quantity: number
  product: { name: string; price: number; reseller_price: number }
}

interface UpgradePath {
  id?: string
  from_package_id: string
  customer_price: number
  pin_price: number
  from_package?: { id: string; name: string }
  products: Array<{ product_id: string; quantity: number; product?: { name: string } }>
}

interface Package {
  id: string
  name: string
  price: number
  direct_referral_bonus: number
  pairing_bonus_value: number
  point_php_value: number
  point_reset_days: number
  daily_product_pairing_cap: number
  product_binary_cap_enabled: boolean
  direct_referral_cap_enabled: boolean
  daily_referral_cap: number
  binary_pair_cap_enabled: boolean
  daily_binary_pair_cap: number
  is_active: boolean
  created_at: string
  products: PackageProduct[]
  upgrade_paths_to: UpgradePath[]
  _count?: { pins: number }
}

// ============================================================
// PAGE
// ============================================================

export default function PackagesPage() {
  const [packages, setPackages]   = useState<Package[]>([])
  const [page, setPage]           = useState(1)
  const [meta, setMeta]           = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 15, totalPages: 1 })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]       = useState('')
  const [products, setProducts]   = useState<Product[]>([])
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [editPkg, setEditPkg]     = useState<Package | null>(null)
  const [form, setForm] = useState({
    name:                      '',
    price:                     '',
    direct_referral_bonus:     '',
    pairing_bonus_value:       '',
    point_php_value:           '10',
    point_reset_days:          '90',
    daily_product_pairing_cap: '50',
    product_binary_cap_enabled: true,
    direct_referral_cap_enabled: true,
    daily_referral_cap:        '10',
    binary_pair_cap_enabled:    true,
    daily_binary_pair_cap:      '10',
  })
  const [selectedProducts, setSelectedProducts] = useState<
    { product_id: string; quantity: number }[]
  >([])
  const [upgradePaths, setUpgradePaths] = useState<UpgradePath[]>([])
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError]     = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  const fetchData = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/admin/packages').then((r) => r.json()),
      fetch('/api/admin/products').then((r) => r.json()),
    ])
      .then(([pkgData, prodData]) => {
        setPackages(pkgData.packages || [])
        setProducts(prodData.products?.filter((p: Product) => p) || [])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search])
  useEffect(() => { fetchData() }, [])

  const openCreate = () => {
    setEditPkg(null)
    setForm({
      name:                      '',
      price:                     '',
      direct_referral_bonus:     '',
      pairing_bonus_value:       '',
      point_php_value:           '10',
      point_reset_days:          '90',
      daily_product_pairing_cap: '50',
      product_binary_cap_enabled: true,
      direct_referral_cap_enabled: true,
      daily_referral_cap:        '10',
      binary_pair_cap_enabled:    true,
      daily_binary_pair_cap:      '10',
    })
    setSelectedProducts([])
    setUpgradePaths([])
    setFormError('')
    setFormSuccess('')
    setShowForm(true)
  }

  const openEdit = (pkg: Package) => {
    setEditPkg(pkg)
    setForm({
      name:                      pkg.name,
      price:                     String(pkg.price),
      direct_referral_bonus:     String(pkg.direct_referral_bonus),
      pairing_bonus_value:       String(pkg.pairing_bonus_value),
      point_php_value:           String(pkg.point_php_value),
      point_reset_days:          String(pkg.point_reset_days),
      daily_product_pairing_cap: String(pkg.daily_product_pairing_cap || 50),
      product_binary_cap_enabled: pkg.product_binary_cap_enabled !== false,
      direct_referral_cap_enabled: pkg.direct_referral_cap_enabled !== false,
      daily_referral_cap:        String(pkg.daily_referral_cap || 10),
      binary_pair_cap_enabled:    pkg.binary_pair_cap_enabled !== false,
      daily_binary_pair_cap:      String(pkg.daily_binary_pair_cap || 10),
    })
    setSelectedProducts(
      pkg.products.map((p) => ({
        product_id: p.product_id,
        quantity:   p.quantity,
      }))
    )
    setUpgradePaths((pkg.upgrade_paths_to || []).map((path) => ({
      from_package_id: path.from_package_id,
      customer_price: Number(path.customer_price),
      pin_price: Number(path.pin_price),
      products: path.products.map((product) => ({
        product_id: product.product_id,
        quantity: product.quantity,
      })),
    })))
    setFormError('')
    setFormSuccess('')
    setShowForm(true)
  }

  const addProduct    = () => setSelectedProducts([...selectedProducts, { product_id: '', quantity: 1 }])
  const removeProduct = (index: number) => setSelectedProducts(selectedProducts.filter((_, i) => i !== index))
  const updateProduct = (index: number, field: string, value: string | number) => {
    const updated = [...selectedProducts]
    updated[index] = { ...updated[index], [field]: value }
    setSelectedProducts(updated)
  }

  const addUpgradePath = () => setUpgradePaths((currentPaths) => {
    const usedSources = new Set(currentPaths.map((path) => path.from_package_id))
    const nextSource = eligibleUpgradeSources.find((pkg) => !usedSources.has(pkg.id))
    if (!nextSource) return currentPaths
    return [
      ...currentPaths,
      {
        from_package_id: nextSource.id,
        customer_price: 0,
        pin_price: 0,
        products: [{ product_id: '', quantity: 1 }],
      },
    ]
  })
  const updateUpgradePath = (index: number, patch: Partial<UpgradePath>) => {
    setUpgradePaths(upgradePaths.map((path, pathIndex) => pathIndex === index ? { ...path, ...patch } : path))
  }
  const updateUpgradeProduct = (pathIndex: number, productIndex: number, field: 'product_id' | 'quantity', value: string | number) => {
    const path = upgradePaths[pathIndex]
    updateUpgradePath(pathIndex, {
      products: path.products.map((product, index) => index === productIndex ? { ...product, [field]: value } : product),
    })
  }

  const handleSubmit = async () => {
    if (!form.name || !form.price || !form.direct_referral_bonus ||
      !form.pairing_bonus_value || !form.point_php_value) {
      setFormError('Please fill in all required fields.')
      return
    }
    if (form.direct_referral_cap_enabled && Number(form.daily_referral_cap) < 1) {
      setFormError('Direct referral daily cap must be at least 1 when enabled.')
      return
    }
    if (form.binary_pair_cap_enabled && Number(form.daily_binary_pair_cap) < 1) {
      setFormError('Registration binary daily cap must be at least 1 when enabled.')
      return
    }
    if (upgradePaths.some((path) => !path.from_package_id || Number(path.customer_price) <= 0 || Number(path.pin_price) <= 0 || path.products.length === 0 || path.products.some((product) => !product.product_id || Number(product.quantity) < 1))) {
      setFormError('Complete every upgrade source, customer price, PIN price, and included product.')
      return
    }

    setFormLoading(true)
    setFormError('')
    setFormSuccess('')

    const url    = editPkg ? `/api/admin/packages/${editPkg.id}` : '/api/admin/packages'
    const method = editPkg ? 'PUT' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:                      form.name.trim(),
        price:                     parseFloat(form.price),
        direct_referral_bonus:     parseFloat(form.direct_referral_bonus),
        pairing_bonus_value:       parseFloat(form.pairing_bonus_value),
        point_php_value:           parseFloat(form.point_php_value),
        point_reset_days:          parseInt(form.point_reset_days),
        daily_product_pairing_cap: parseInt(form.daily_product_pairing_cap),
        product_binary_cap_enabled: form.product_binary_cap_enabled,
        direct_referral_cap_enabled: form.direct_referral_cap_enabled,
        daily_referral_cap:        parseInt(form.daily_referral_cap) || 10,
        binary_pair_cap_enabled:    form.binary_pair_cap_enabled,
        daily_binary_pair_cap:      parseInt(form.daily_binary_pair_cap) || 10,
        products:                  selectedProducts.filter((p) => p.product_id),
        upgrade_paths:             upgradePaths,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      setFormError(data.error || 'Failed to save package.')
    } else {
      setFormSuccess(editPkg ? 'Package updated!' : 'Package created!')
      fetchData()
      setTimeout(() => { setShowForm(false); setFormSuccess('') }, 1200)
    }
    setFormLoading(false)
  }

  const handleToggle = async (id: string, current: boolean) => {
    await fetch(`/api/admin/packages/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: !current }),
    })
    fetchData()
  }

  const eligibleUpgradeSources = editPkg
    ? packages.filter((pkg) =>
        pkg.id !== editPkg.id &&
        Number(pkg.pairing_bonus_value) < Number(form.pairing_bonus_value || 0) &&
        Number(pkg.price) < Number(form.price || 0)
      ).sort((a, b) => Number(a.pairing_bonus_value) - Number(b.pairing_bonus_value))
    : []

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Packages</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage starter packages and their bonus values
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors"
        >
          + Create package
        </button>
      </div>

      {/* Package Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : packages.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-12 text-center">
          <p className="text-gray-400 text-sm mb-2">No packages yet</p>
          <button onClick={openCreate} className="text-xs text-[#C9A84C] hover:underline">
            Create your first package →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {packages.map((pkg) => (
            <div key={pkg.id} className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden hover:shadow-md transition-shadow">
              {/* Card Header */}
              <div className="bg-[#010521] px-4 py-3 flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold text-sm">{pkg.name}</h3>
                  <p className="text-[#C9A84C] text-xs mt-0.5">
                    PIN allocation: ₱{Number(pkg.price).toLocaleString()}
                  </p>
                  {pkg.products.length > 0 && (
                    <p className="text-[#e8f7ef] text-xs mt-0.5">
                      Customer price: ₱{pkg.products.reduce((s, p) => s + Number(p.product.price || p.product.reseller_price || 0) * p.quantity, 0).toLocaleString()}
                    </p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${pkg.is_active ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fdecea] text-[#a03030]'}`}>
                  {pkg.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Bonus Values */}
              <div className="p-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Bonus values</p>
                <div className="flex flex-col gap-1.5 mb-4">
                  {[
                    { label: 'Direct referral bonus',       value: `₱${Number(pkg.direct_referral_bonus).toLocaleString()}` },
                    { label: 'Binary Points',               value: `${Number(pkg.pairing_bonus_value).toLocaleString()} pts` },
                    { label: 'Product Binary Point Value',  value: `${Number(pkg.point_php_value).toLocaleString()} pts` },
                    { label: 'Point reset period',          value: `Every ${pkg.point_reset_days} days` },
                    {
                      label: 'Product Binary Daily Cap',
                      value: pkg.product_binary_cap_enabled !== false
                        ? `${pkg.daily_product_pairing_cap || 50} pairs/day`
                        : 'Unlimited (Off)',
                    },
                    {
                      label: 'Direct Referral Daily Cap',
                      value: pkg.direct_referral_cap_enabled
                        ? `${pkg.daily_referral_cap || 10} referrals/day`
                        : 'Unlimited (Off)',
                    },
                    {
                      label: 'Registration Binary Daily Cap',
                      value: pkg.binary_pair_cap_enabled
                        ? `${pkg.daily_binary_pair_cap || 10} pairs/day`
                        : 'Unlimited (Off)',
                    },
                  ].map((item) => (
                    <div key={item.label} className="flex justify-between py-1 border-b border-[#0D1B3E]/5">
                      <span className="text-xs text-gray-400">{item.label}</span>
                      <span className="text-xs font-medium text-[#0D1B3E]">{item.value}</span>
                    </div>
                  ))}
                </div>

                {/* Products */}
                {pkg.products.length > 0 && (
                  <>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Included products</p>
                    <div className="flex flex-col gap-1 mb-4">
                      {pkg.products.map((p) => (
                        <div key={p.product_id} className="flex justify-between">
                          <span className="text-xs text-[#0D1B3E]">{p.product.name}</span>
                          <span className="text-xs text-gray-400">x{p.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {pkg.upgrade_paths_to?.length > 0 && (
                  <>
                    <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">Upgrade options</p>
                    <div className="mb-4 flex flex-col gap-1.5">
                      {pkg.upgrade_paths_to.map((path) => (
                        <div key={path.from_package_id} className="rounded-lg bg-[#fffaf0] px-2.5 py-2 text-xs">
                          <div className="flex justify-between font-medium text-[#0D1B3E]"><span>{path.from_package?.name} → {pkg.name}</span><span>PIN ₱{Number(path.pin_price).toLocaleString()}</span></div>
                          <div className="mt-0.5 flex justify-between text-[10px] text-gray-500"><span>{path.products.reduce((sum, item) => sum + item.quantity, 0)} products</span><span>Customer ₱{Number(path.customer_price).toLocaleString()}</span></div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t border-[#0D1B3E]/5">
                  <button onClick={() => openEdit(pkg)} className="flex-1 text-xs text-[#C9A84C] font-medium hover:underline">
                    Edit
                  </button>
                  <button onClick={() => handleToggle(pkg.id, pkg.is_active)}
                    className={`flex-1 text-xs font-medium hover:underline ${pkg.is_active ? 'text-red-400' : 'text-[#1a7a4a]'}`}>
                    {pkg.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
            <div className="bg-[#010521] px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">
                {editPkg ? 'Edit package' : 'Create new package'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-white/50 hover:text-white text-lg cursor-pointer">✕</button>
            </div>

            <div className="p-6 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">

              {/* Package name & price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Package name <span className="text-[#C9A84C]">*</span></label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Gold, Silver"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">PIN Price (PHP) <span className="text-[#C9A84C]">*</span></label>
                  <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="e.g. 2500"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
                </div>
              </div>

              {/* Bonus Values */}
              <div className="bg-[#F0F2F8] rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-[#0D1B3E] mb-1">Bonus values</p>
                {[
                  {
                    label: 'Direct Referral Bonus',
                    hint:  'Fixed ₱ paid to referrer on join',
                    required: true,
                    input: <input type="number" value={form.direct_referral_bonus}
                      onChange={(e) => setForm({ ...form, direct_referral_bonus: e.target.value })}
                      placeholder="e.g. 500"
                      className="w-28 bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />,
                  },
                  {
                    label: 'Binary Points Value',
                    hint: form.pairing_bonus_value && form.point_php_value
                      ? `1 pair (${form.pairing_bonus_value}pts) = ₱${(Number(form.pairing_bonus_value) * 0.50).toFixed(2)}`
                      : 'Points added to upline on join',
                    required: true,
                    input: <input type="number" value={form.pairing_bonus_value}
                      onChange={(e) => setForm({ ...form, pairing_bonus_value: e.target.value })}
                      placeholder="e.g. 100"
                      className="w-28 bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />,
                  },
                  {
                    label: 'Product Binary Base',
                    hint: 'Universal rule: 10 points × ₱0.50 = ₱5 per pair',
                    required: true,
                    input: <input type="number" value="10" readOnly aria-label="Product Binary base points"
                      className="w-28 bg-gray-50 border border-[#0D1B3E]/10 rounded-lg px-3 py-2 text-sm text-gray-500" />,
                  },
                  {
                    label: 'Qualification Season',
                    hint:  'Automatic calendar quarter (Q1, Q2, Q3, Q4)',
                    required: false,
                    input: <span className="w-28 rounded-lg border border-[#0D1B3E]/10 bg-gray-50 px-3 py-2 text-center text-xs font-semibold text-gray-500">Quarterly</span>,
                  },
                  {
                    label: 'Direct Referral Daily Cap',
                    hint: form.direct_referral_cap_enabled
                      ? 'Excess referrals go to Hiroma after this daily limit'
                      : 'Disabled — direct referrals are unlimited',
                    required: false,
                    input: (
                      <div className="flex shrink-0 items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, direct_referral_cap_enabled: !form.direct_referral_cap_enabled })}
                          className={`inline-flex h-9 w-[74px] shrink-0 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-bold tracking-wide transition-colors ${
                            form.direct_referral_cap_enabled
                              ? 'border-[#16814d] bg-[#e8f7ef] text-[#126b41]'
                              : 'border-gray-300 bg-gray-100 text-gray-500'
                          }`}
                          aria-pressed={form.direct_referral_cap_enabled}
                        >
                          <span className={`h-2 w-2 rounded-full ${
                            form.direct_referral_cap_enabled ? 'bg-[#16814d]' : 'bg-gray-400'
                          }`} />
                          {form.direct_referral_cap_enabled ? 'ON' : 'OFF'}
                        </button>
                        <input
                          type="number"
                          min="1"
                          disabled={!form.direct_referral_cap_enabled}
                          value={form.daily_referral_cap}
                          onChange={(e) => setForm({ ...form, daily_referral_cap: e.target.value })}
                          placeholder="e.g. 10"
                          aria-label="Direct referral daily limit"
                          className="h-9 w-[72px] shrink-0 rounded-lg border border-[#0D1B3E]/15 bg-white px-3 text-sm outline-none focus:border-[#C9A84C] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                        />
                      </div>
                    ),
                  },
                  {
                    label: 'Registration Binary Daily Cap',
                    hint: form.binary_pair_cap_enabled
                      ? 'Excess package-binary pairs go to Hiroma after this daily limit'
                      : 'Disabled — registration binary pairs are unlimited',
                    required: false,
                    input: (
                      <div className="flex shrink-0 items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, binary_pair_cap_enabled: !form.binary_pair_cap_enabled })}
                          className={`inline-flex h-9 w-[74px] shrink-0 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-bold tracking-wide transition-colors ${
                            form.binary_pair_cap_enabled
                              ? 'border-[#16814d] bg-[#e8f7ef] text-[#126b41]'
                              : 'border-gray-300 bg-gray-100 text-gray-500'
                          }`}
                          aria-pressed={form.binary_pair_cap_enabled}
                        >
                          <span className={`h-2 w-2 rounded-full ${
                            form.binary_pair_cap_enabled ? 'bg-[#16814d]' : 'bg-gray-400'
                          }`} />
                          {form.binary_pair_cap_enabled ? 'ON' : 'OFF'}
                        </button>
                        <input
                          type="number"
                          min="1"
                          disabled={!form.binary_pair_cap_enabled}
                          value={form.daily_binary_pair_cap}
                          onChange={(e) => setForm({ ...form, daily_binary_pair_cap: e.target.value })}
                          placeholder="e.g. 10"
                          aria-label="Registration binary daily limit"
                          className="h-9 w-[72px] shrink-0 rounded-lg border border-[#0D1B3E]/15 bg-white px-3 text-sm outline-none focus:border-[#C9A84C] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                        />
                      </div>
                    ),
                  },
                  {
                    label: 'Product Binary Daily Cap',
                    hint: form.product_binary_cap_enabled
                      ? 'Excess product-binary pairs go to Hiroma after this daily limit'
                      : 'Disabled — product-binary pairs are unlimited',
                    required: false,
                    input: (
                      <div className="flex shrink-0 items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, product_binary_cap_enabled: !form.product_binary_cap_enabled })}
                          className={`inline-flex h-9 w-[74px] shrink-0 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-bold tracking-wide transition-colors ${
                            form.product_binary_cap_enabled
                              ? 'border-[#16814d] bg-[#e8f7ef] text-[#126b41]'
                              : 'border-gray-300 bg-gray-100 text-gray-500'
                          }`}
                          aria-pressed={form.product_binary_cap_enabled}
                        >
                          <span className={`h-2 w-2 rounded-full ${
                            form.product_binary_cap_enabled ? 'bg-[#16814d]' : 'bg-gray-400'
                          }`} />
                          {form.product_binary_cap_enabled ? 'ON' : 'OFF'}
                        </button>
                        <input
                          type="number"
                          min="1"
                          disabled={!form.product_binary_cap_enabled}
                          value={form.daily_product_pairing_cap}
                          onChange={(e) => setForm({ ...form, daily_product_pairing_cap: e.target.value })}
                          placeholder="e.g. 50"
                          aria-label="Product binary daily limit"
                          className="h-9 w-[72px] shrink-0 rounded-lg border border-[#0D1B3E]/15 bg-white px-3 text-sm outline-none focus:border-[#C9A84C] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                        />
                      </div>
                    ),
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 bg-white rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#0D1B3E]">
                        {row.label}
                        {row.required && <span className="text-[#C9A84C] ml-0.5">*</span>}
                      </p>
                      <p className="text-[10px] text-gray-400">{row.hint}</p>
                    </div>
                    {row.input}
                  </div>
                ))}
              </div>

              {/* Products in package */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-400">Included products</label>
                    {selectedProducts.length > 0 && (() => {
                      const productTotal = selectedProducts.reduce((sum, sp) => {
                        const prod = products.find((p) => p.id === sp.product_id)
                        return sum + (Number(prod?.price || prod?.reseller_price || 0) * Number(sp.quantity))
                      }, 0)
                      return (
                        <div className="text-right">
                          <p className="text-[10px] text-gray-400">
                            Customer package price: <span className="text-[#0D1B3E] font-medium">₱{productTotal.toLocaleString()}</span>
                          </p>
                          <p className="text-[10px] text-gray-400">
                            PIN allocation inside package: <span className="text-[#1a7a4a] font-medium">
                              ₱{(parseFloat(form.price) || 0).toLocaleString()}
                            </span>
                          </p>
                        </div>
                      )
                    })()}
                  </div>
                  <button onClick={addProduct} className="text-xs text-[#C9A84C] hover:underline font-medium">
                    + Add product
                  </button>
                </div>
                {selectedProducts.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No products added yet</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {selectedProducts.map((sp, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <select value={sp.product_id} onChange={(e) => updateProduct(index, 'product_id', e.target.value)}
                          className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]">
                          <option value="">Select product</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — SRP: ₱{Number(p.price).toLocaleString()}
                            </option>
                          ))}
                        </select>
                        <input type="number" min="1" value={sp.quantity || ''}
                          onChange={(e) => updateProduct(index, 'quantity', parseInt(e.target.value))}
                          className="w-16 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-2 text-sm outline-none focus:border-[#C9A84C] text-center" />
                        <button onClick={() => removeProduct(index)} className="text-red-400 hover:text-red-600 text-sm">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {editPkg && (eligibleUpgradeSources.length > 0 || upgradePaths.length > 0) && (
                <div className="rounded-xl border border-[#C9A84C]/40 bg-[#fffaf0] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#0D1B3E]">Upgrade options to {form.name || editPkg.name}</p>
                      <p className="mt-0.5 text-[10px] text-gray-500">Set the exact payment, Upgrade PIN price, and physical products released for each source package.</p>
                    </div>
                    {upgradePaths.length < eligibleUpgradeSources.length && (
                      <button type="button" onClick={addUpgradePath} className="shrink-0 text-xs font-semibold text-[#9a7418] hover:underline">+ Add upgrade source</button>
                    )}
                  </div>
                  {upgradePaths.length === 0 ? (
                    <p className="mt-3 rounded-lg bg-white/70 px-3 py-3 text-xs italic text-gray-400">No package can upgrade to this package yet.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {upgradePaths.map((path, pathIndex) => (
                        <div key={pathIndex} className="rounded-lg border border-[#0D1B3E]/10 bg-white p-3">
                          <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
                            <label className="text-[10px] text-gray-500">Upgrade from
                              <select value={path.from_package_id} onChange={(event) => updateUpgradePath(pathIndex, { from_package_id: event.target.value })} className="mt-1 w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-2 py-2 text-xs text-[#0D1B3E]">
                                <option value="">Select source...</option>
                                {eligibleUpgradeSources.filter((pkg) => !upgradePaths.some((other, index) => index !== pathIndex && other.from_package_id === pkg.id)).map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}
                              </select>
                            </label>
                            <label className="text-[10px] text-gray-500">Customer upgrade price
                              <input type="number" min="0.01" step="0.01" value={path.customer_price || ''} onChange={(event) => updateUpgradePath(pathIndex, { customer_price: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-2 py-2 text-xs" placeholder="2490" />
                            </label>
                            <label className="text-[10px] text-gray-500">Upgrade PIN price
                              <input type="number" min="0.01" step="0.01" value={path.pin_price || ''} onChange={(event) => updateUpgradePath(pathIndex, { pin_price: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-2 py-2 text-xs" placeholder="660" />
                            </label>
                            <button type="button" onClick={() => setUpgradePaths(upgradePaths.filter((_, index) => index !== pathIndex))} className="self-end px-2 py-2 text-xs text-red-500 hover:underline">Remove</button>
                          </div>
                          <div className="mt-3">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Products released on this upgrade</p>
                              <button type="button" onClick={() => updateUpgradePath(pathIndex, { products: [...path.products, { product_id: '', quantity: 1 }] })} className="text-[10px] font-semibold text-[#9a7418] hover:underline">+ Add product</button>
                            </div>
                            <div className="mt-1.5 space-y-1.5">
                              {path.products.map((upgradeProduct, productIndex) => (
                                <div key={productIndex} className="flex gap-2">
                                  <select value={upgradeProduct.product_id} onChange={(event) => updateUpgradeProduct(pathIndex, productIndex, 'product_id', event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-2 py-2 text-xs">
                                    <option value="">Select product...</option>
                                    {products.filter((product) => !path.products.some((other, index) => index !== productIndex && other.product_id === product.id)).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                                  </select>
                                  <input type="number" min="1" value={upgradeProduct.quantity || ''} onChange={(event) => updateUpgradeProduct(pathIndex, productIndex, 'quantity', Number(event.target.value))} className="w-20 rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-2 py-2 text-center text-xs" aria-label="Upgrade product quantity" />
                                  <button type="button" onClick={() => updateUpgradePath(pathIndex, { products: path.products.filter((_, index) => index !== productIndex) })} className="px-1 text-xs text-red-400">✕</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <p className="text-red-500 text-xs">{formError}</p>
                </div>
              )}
              {formSuccess && (
                <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-3 py-2">
                  <p className="text-[#1a7a4a] text-xs">{formSuccess}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors">
                  Cancel
                </button>
                <button onClick={handleSubmit} disabled={formLoading}
                  className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60">
                  {formLoading ? 'Saving...' : editPkg ? 'Update package' : 'Create package'}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      <div className="mt-4">
        <Pagination meta={meta} onPageChange={setPage} />
      </div>

    </div>
  )
}
