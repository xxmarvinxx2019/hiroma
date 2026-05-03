'use client'

import { useState, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

interface Product {
  id: string
  name: string
  description: string | null
  type: string
  price: number
  image_url: string | null
  is_active: boolean
  created_at: string
}

// ============================================================
// PAGE
// ============================================================

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'physical' | 'digital'>('all')
  const [showForm, setShowForm] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'physical',
    price: '',
    image_url: '',
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  const fetchProducts = () => {
    setLoading(true)
    fetch('/api/admin/products')
      .then((r) => r.json())
      .then((data) => setProducts(data.products || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchProducts() }, [])

  const filtered = products.filter((p) => {
    const matchType = typeFilter === 'all' || p.type === typeFilter
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description || '').toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  const openCreate = () => {
    setEditProduct(null)
    setForm({ name: '', description: '', type: 'physical', price: '', image_url: '' })
    setFormError('')
    setFormSuccess('')
    setShowForm(true)
  }

  const openEdit = (p: Product) => {
    setEditProduct(p)
    setForm({
      name: p.name,
      description: p.description || '',
      type: p.type,
      price: String(p.price),
      image_url: p.image_url || '',
    })
    setFormError('')
    setFormSuccess('')
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!form.name || !form.price) {
      setFormError('Name and price are required.')
      return
    }
    setFormLoading(true)
    setFormError('')
    setFormSuccess('')

    const url = editProduct
      ? `/api/admin/products/${editProduct.id}`
      : '/api/admin/products'
    const method = editProduct ? 'PUT' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, price: parseFloat(form.price) }),
    })
    const data = await res.json()

    if (!res.ok) {
      setFormError(data.error || 'Failed to save product.')
    } else {
      setFormSuccess(editProduct ? 'Product updated!' : 'Product created!')
      fetchProducts()
      setTimeout(() => { setShowForm(false); setFormSuccess('') }, 1200)
    }
    setFormLoading(false)
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    await fetch(`/api/admin/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !current }),
    })
    fetchProducts()
  }

  const totalActive = products.filter((p) => p.is_active).length
  const totalPhysical = products.filter((p) => p.type === 'physical').length
  const totalDigital = products.filter((p) => p.type === 'digital').length

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Products</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage your product catalog
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors"
        >
          + Add product
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total products', value: products.length, accent: 'navy' },
          { label: 'Physical', value: totalPhysical, accent: 'gold' },
          { label: 'Digital', value: totalDigital, accent: 'navy' },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent === 'gold' ? '#C9A84C' : '#0D1B3E'}` }}
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent === 'gold' ? '#C9A84C' : '#0D1B3E' }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Product Grid */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Search & Filter */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1">
            {(['all', 'physical', 'digital'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  typeFilter === f
                    ? 'bg-[#0D1B3E] text-white'
                    : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-6 px-4 py-2 bg-[#F0F2F8]">
          {['Product', 'Type', 'Price', 'Status', 'Added', 'Actions'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm mb-2">No products yet</p>
            <button
              onClick={openCreate}
              className="text-xs text-[#C9A84C] hover:underline"
            >
              Add your first product →
            </button>
          </div>
        ) : (
          filtered.map((p) => (
            <div
              key={p.id}
              className="grid grid-cols-6 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
            >
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{p.name}</p>
                {p.description && (
                  <p className="text-xs text-gray-400 truncate max-w-[160px]">{p.description}</p>
                )}
              </div>
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  p.type === 'physical'
                    ? 'bg-[#eef0f8] text-[#0D1B3E]'
                    : 'bg-[#fef6e4] text-[#9a6f1e]'
                }`}>
                  {p.type === 'physical' ? '📦 Physical' : '💾 Digital'}
                </span>
              </span>
              <p className="text-xs font-semibold text-[#C9A84C]">
                ₱{Number(p.price).toLocaleString()}
              </p>
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  p.is_active
                    ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                    : 'bg-[#fdecea] text-[#a03030]'
                }`}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </span>
              </span>
              <p className="text-xs text-gray-400">
                {new Date(p.created_at).toLocaleDateString('en-PH')}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => openEdit(p)}
                  className="text-xs text-[#C9A84C] hover:underline font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleToggleActive(p.id, p.is_active)}
                  className={`text-xs hover:underline font-medium ${
                    p.is_active ? 'text-red-400' : 'text-[#1a7a4a]'
                  }`}
                >
                  {p.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">
                {editProduct ? 'Edit product' : 'Add new product'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-white/50 hover:text-white text-lg cursor-pointer">✕</button>
            </div>
            <div className="p-6 flex flex-col gap-4">

              <div>
                <label className="block text-xs text-gray-400 mb-1">Product name <span className="text-[#C9A84C]">*</span></label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Hiroma Oud 50ml"
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Product description..."
                  rows={2}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C] resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Type <span className="text-[#C9A84C]">*</span></label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  >
                    <option value="physical">Physical</option>
                    <option value="digital">Digital</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Price (PHP) <span className="text-[#C9A84C]">*</span></label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="e.g. 850"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Image URL</label>
                <input
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="https://..."
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                />
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
                  {formLoading ? 'Saving...' : editProduct ? 'Update product' : 'Add product'}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  )
}