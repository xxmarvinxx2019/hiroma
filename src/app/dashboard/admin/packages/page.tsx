'use client'

import { useState, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

interface Product {
  id: string
  name: string
  price: number
  type: string
}

interface PackageProduct {
  product_id: string
  quantity: number
  product: { name: string; price: number }
}

interface Package {
  id: string
  name: string
  price: number
  direct_referral_bonus: number
  pairing_bonus_value: number
  point_php_value: number
  point_reset_days: number
  is_active: boolean
  created_at: string
  products: PackageProduct[]
  _count?: { pins: number }
}

// ============================================================
// PAGE
// ============================================================

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPkg, setEditPkg] = useState<Package | null>(null)
  const [form, setForm] = useState({
    name: '',
    price: '',
    direct_referral_bonus: '',
    pairing_bonus_value: '',
    point_php_value: '',
    point_reset_days: '30',
  })
  const [selectedProducts, setSelectedProducts] = useState<
    { product_id: string; quantity: number }[]
  >([])
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')
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

  useEffect(() => { fetchData() }, [])

  const openCreate = () => {
    setEditPkg(null)
    setForm({
      name: '',
      price: '',
      direct_referral_bonus: '',
      pairing_bonus_value: '',
      point_php_value: '',
      point_reset_days: '30',
    })
    setSelectedProducts([])
    setFormError('')
    setFormSuccess('')
    setShowForm(true)
  }

  const openEdit = (pkg: Package) => {
    setEditPkg(pkg)
    setForm({
      name: pkg.name,
      price: String(pkg.price),
      direct_referral_bonus: String(pkg.direct_referral_bonus),
      pairing_bonus_value: String(pkg.pairing_bonus_value),
      point_php_value: String(pkg.point_php_value),
      point_reset_days: String(pkg.point_reset_days),
    })
    setSelectedProducts(
      pkg.products.map((p) => ({
        product_id: p.product_id,
        quantity: p.quantity,
      }))
    )
    setFormError('')
    setFormSuccess('')
    setShowForm(true)
  }

  const addProduct = () => {
    setSelectedProducts([...selectedProducts, { product_id: '', quantity: 1 }])
  }

  const updateProduct = (index: number, field: string, value: string | number) => {
    const updated = [...selectedProducts]
    updated[index] = { ...updated[index], [field]: value }
    setSelectedProducts(updated)
  }

  const removeProduct = (index: number) => {
    setSelectedProducts(selectedProducts.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (!form.name || !form.price || !form.direct_referral_bonus ||
      !form.pairing_bonus_value || !form.point_php_value) {
      setFormError('Please fill in all required fields.')
      return
    }

    setFormLoading(true)
    setFormError('')
    setFormSuccess('')

    const url = editPkg ? `/api/admin/packages/${editPkg.id}` : '/api/admin/packages'
    const method = editPkg ? 'PUT' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        price: parseFloat(form.price),
        direct_referral_bonus: parseFloat(form.direct_referral_bonus),
        pairing_bonus_value: parseFloat(form.pairing_bonus_value),
        point_php_value: parseFloat(form.point_php_value),
        point_reset_days: parseInt(form.point_reset_days),
        products: selectedProducts.filter((p) => p.product_id),
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
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !current }),
    })
    fetchData()
  }

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
          <button
            onClick={openCreate}
            className="text-xs text-[#C9A84C] hover:underline"
          >
            Create your first package →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Card Header */}
              <div className="bg-[#0D1B3E] px-4 py-3 flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold text-sm">{pkg.name}</h3>
                  <p className="text-[#C9A84C] text-xs mt-0.5">
                    ₱{Number(pkg.price).toLocaleString()}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  pkg.is_active
                    ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                    : 'bg-[#fdecea] text-[#a03030]'
                }`}>
                  {pkg.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Bonus Values */}
              <div className="p-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">
                  Bonus values
                </p>
                <div className="flex flex-col gap-1.5 mb-4">
                  {[
                    { label: 'Direct referral bonus', value: `₱${Number(pkg.direct_referral_bonus).toLocaleString()}` },
                    { label: 'Binary pairing bonus', value: `₱${Number(pkg.pairing_bonus_value).toLocaleString()}` },
                    { label: 'Point PHP value', value: `₱${Number(pkg.point_php_value).toLocaleString()} / pt` },
                    { label: 'Point reset period', value: `Every ${pkg.point_reset_days} days` },
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
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">
                      Included products
                    </p>
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

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t border-[#0D1B3E]/5">
                  <button
                    onClick={() => openEdit(pkg)}
                    className="flex-1 text-xs text-[#C9A84C] font-medium hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggle(pkg.id, pkg.is_active)}
                    className={`flex-1 text-xs font-medium hover:underline ${
                      pkg.is_active ? 'text-red-400' : 'text-[#1a7a4a]'
                    }`}
                  >
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
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between">
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
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Gold, Silver"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Price (PHP) <span className="text-[#C9A84C]">*</span></label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="e.g. 2500"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
              </div>

              {/* Bonus Values */}
              <div className="bg-[#F0F2F8] rounded-lg p-3">
                <p className="text-xs font-medium text-[#0D1B3E] mb-3">Bonus values</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Direct referral bonus (PHP) <span className="text-[#C9A84C]">*</span></label>
                    <input
                      type="number"
                      value={form.direct_referral_bonus}
                      onChange={(e) => setForm({ ...form, direct_referral_bonus: e.target.value })}
                      placeholder="e.g. 500"
                      className="w-full bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Binary pairing bonus (PHP) <span className="text-[#C9A84C]">*</span></label>
                    <input
                      type="number"
                      value={form.pairing_bonus_value}
                      onChange={(e) => setForm({ ...form, pairing_bonus_value: e.target.value })}
                      placeholder="e.g. 300"
                      className="w-full bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Point PHP value <span className="text-[#C9A84C]">*</span></label>
                    <input
                      type="number"
                      value={form.point_php_value}
                      onChange={(e) => setForm({ ...form, point_php_value: e.target.value })}
                      placeholder="e.g. 50"
                      className="w-full bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Point reset (days)</label>
                    <input
                      type="number"
                      value={form.point_reset_days}
                      onChange={(e) => setForm({ ...form, point_reset_days: e.target.value })}
                      placeholder="e.g. 30"
                      className="w-full bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                    />
                  </div>
                </div>
              </div>

              {/* Products in package */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-400">Included products</label>
                  <button
                    onClick={addProduct}
                    className="text-xs text-[#C9A84C] hover:underline font-medium"
                  >
                    + Add product
                  </button>
                </div>
                {selectedProducts.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No products added yet</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {selectedProducts.map((sp, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <select
                          value={sp.product_id}
                          onChange={(e) => updateProduct(index, 'product_id', e.target.value)}
                          className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                        >
                          <option value="">Select product</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — ₱{Number(p.price).toLocaleString()}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          value={sp.quantity}
                          onChange={(e) => updateProduct(index, 'quantity', parseInt(e.target.value))}
                          className="w-16 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-2 text-sm outline-none focus:border-[#C9A84C] text-center"
                        />
                        <button
                          onClick={() => removeProduct(index)}
                          className="text-red-400 hover:text-red-600 text-sm"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={formLoading}
                  className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60"
                >
                  {formLoading ? 'Saving...' : editPkg ? 'Update package' : 'Create package'}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  )
}