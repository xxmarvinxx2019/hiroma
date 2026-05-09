'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from "@/app/components/ui/Pagination"

// ============================================================
// TYPES
// ============================================================

interface Product {
  id:               string
  name:             string
  description:      string | null
  type:             string
  cost_price:       number
  regional_price:   number
  provincial_price: number
  city_price:       number
  reseller_price:   number
  image_url:        string | null
  is_active:        boolean
  created_at:       string
}

// ============================================================
// PAGE
// ============================================================

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'physical' | 'digital'>('all')
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 15, totalPages: 1 })
  const [stats, setStats] = useState({ total: 0, physical: 0, digital: 0, active: 0, inactive: 0 })
  const [showForm, setShowForm] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [form, setForm] = useState({
    name:             '',
    description:      '',
    type:             'physical',
    cost_price:       '',
    regional_price:   '',
    provincial_price: '',
    city_price:       '',
    reseller_price:   '',
    image_url:        '',
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [typeFilter, search])

  const fetchProducts = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), pageSize: '15',
      ...(typeFilter !== 'all' && { type: typeFilter }),
      ...(search && { search }),
    })
    fetch(`/api/admin/products?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setProducts(data.products || [])
        if (data.meta)  setMeta(data.meta)
        if (data.stats) setStats(data.stats)
        setLoading(false)
      })
  }, [page, typeFilter, search])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  const filtered = products

  const openCreate = () => {
    setEditProduct(null)
    setForm({ name: '', description: '', type: 'physical', cost_price: '', regional_price: '', provincial_price: '', city_price: '', reseller_price: '', image_url: '' })
    setFormError('')
    setFormSuccess('')
    setShowForm(true)
  }

  const openEdit = (p: Product) => {
    setEditProduct(p)
    setForm({
      name:             p.name,
      description:      p.description      || '',
      type:             p.type,
      cost_price:       String(p.cost_price),
      regional_price:   String(p.regional_price),
      provincial_price: String(p.provincial_price),
      city_price:       String(p.city_price),
      reseller_price:   String(p.reseller_price),
      image_url:        p.image_url         || '',
    })
    setFormError('')
    setFormSuccess('')
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!form.name || !form.reseller_price) {
      setFormError('Name and reseller price are required.')
      return
    }
    setFormLoading(true)
    setFormError('')
    setFormSuccess('')

    const url    = '/api/admin/products'
    const method = editProduct ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(editProduct && { id: editProduct.id }), ...form }),
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
    await fetch('/api/admin/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !current }),
    })
    fetchProducts()
  }


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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total',    value: stats.total,    accent: '#0D1B3E' },
          { label: 'Physical', value: stats.physical, accent: '#0D1B3E' },
          { label: 'Digital',  value: stats.digital,  accent: '#2563eb' },
          { label: 'Active',   value: stats.active,   accent: '#1a7a4a' },
          { label: 'Inactive', value: stats.inactive, accent: '#e05252' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Product Grid */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Search & Filter */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
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
              <div>
                <p className="text-xs font-semibold text-[#C9A84C]">₱{Number(p.reseller_price).toLocaleString()} <span className="text-gray-400 font-normal">SRP</span></p>
                <p className="text-[10px] text-gray-400">Cost: ₱{Number(p.cost_price).toLocaleString()}</p>
              </div>
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
        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4 py-6">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-full">
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">
                {editProduct ? 'Edit product' : 'Add new product'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-white/50 hover:text-white text-lg cursor-pointer">✕</button>
            </div>
            <div className="p-6 flex flex-col gap-4 overflow-y-auto">

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

              {/* Price points */}
              <div className="bg-[#F0F2F8] rounded-xl p-3 space-y-3">
                <p className="text-xs font-medium text-[#0D1B3E]">Price Points</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Cost Price',       key: 'cost_price',       hint: 'Production/source cost' },
                    { label: 'Regional Price',   key: 'regional_price',   hint: 'Regional distributor pays' },
                    { label: 'Provincial Price', key: 'provincial_price', hint: 'Provincial distributor pays' },
                    { label: 'City Price',       key: 'city_price',       hint: 'City distributor pays' },
                    { label: 'Reseller Price',   key: 'reseller_price',   hint: 'SRP / reseller reference *' },
                  ].map((f) => (
                    <div key={f.key} className={f.key === 'reseller_price' ? 'col-span-2' : ''}>
                      <label className="block text-xs text-gray-400 mb-1">
                        {f.label} {f.key === 'reseller_price' && <span className="text-[#C9A84C]">*</span>}
                      </label>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">₱</span>
                        <input
                          type="number" min={0}
                          value={form[f.key as keyof typeof form]}
                          onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                          placeholder="0.00"
                          className="w-full bg-white border border-[#0D1B3E]/15 rounded-lg pl-6 pr-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                        />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">{f.hint}</p>
                    </div>
                  ))}
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