'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface InventoryItem {
  id: string
  quantity: number
  low_stock_threshold: number
  updated_at: string
  owner:   { id: string; full_name: string; username: string; role: string }
  product: { id: string; name: string; type: string; price: number }
}

interface Distributor {
  id: string
  full_name: string
  username: string
  role: string
}

interface Product {
  id: string
  name: string
  type: string
  price: number
}

const PAGE_SIZE = 20

const ROLE_COLOR: Record<string, string> = {
  regional:   'bg-[#f0f7ff] text-[#2563eb]',
  provincial: 'bg-[#fef9ee] text-[#9a6f1e]',
  city:       'bg-[#e8f7ef] text-[#1a7a4a]',
}

// ============================================================
// ASSIGN STOCK MODAL
// ============================================================

function AssignStockModal({
  distributors,
  onClose,
  onSuccess,
}: {
  distributors: Distributor[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [products, setProducts]       = useState<Product[]>([])
  const [ownerId, setOwnerId]         = useState('')
  const [productId, setProductId]     = useState('')
  const [quantity, setQuantity]       = useState('')
  const [threshold, setThreshold]     = useState('10')
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState('')
  const [productSearch, setProductSearch] = useState('')

  useEffect(() => {
    fetch('/api/admin/products')
      .then((r) => r.json())
      .then((d) => setProducts(d.products?.filter((p: Product & { is_active: boolean }) => p.is_active) || []))
  }, [])

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  )

  const handleSubmit = async () => {
    if (!ownerId || !productId || !quantity) {
      setError('All fields are required.')
      return
    }
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/admin/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_id:            ownerId,
        product_id:          productId,
        quantity:            parseInt(quantity),
        low_stock_threshold: parseInt(threshold),
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) onSuccess()
    else setError(data.error || 'Something went wrong.')
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Assign Stock</h2>
            <p className="text-xs text-gray-400 mt-0.5">Add inventory to a distributor</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Distributor */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Distributor</label>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors"
            >
              <option value="">Select distributor...</option>
              {['regional', 'provincial', 'city'].map((role) => (
                <optgroup key={role} label={role.charAt(0).toUpperCase() + role.slice(1)}>
                  {distributors.filter((d) => d.role === role).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name} (@{d.username})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Product search */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
            <input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search product..."
              className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400 mb-1"
            />
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              size={5}
              className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-1.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors"
            >
              {filteredProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ₱{Number(p.price).toLocaleString()} ({p.type})
                </option>
              ))}
            </select>
          </div>

          {/* Quantity + threshold */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Quantity to Add</label>
              <input
                type="number" min={1} value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 100"
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Low Stock Alert</label>
              <input
                type="number" min={0} value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="e.g. 10"
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
              />
            </div>
          </div>

          {error && <p className="text-xs text-[#a03030] bg-[#fdecea] px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 bg-[#F0F2F8] text-gray-500 text-sm py-2 rounded-lg hover:bg-[#e4e6ef] transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="flex-1 bg-[#C9A84C] text-white text-sm py-2 rounded-lg hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium">
              {submitting ? 'Assigning...' : 'Assign Stock'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function AdminInventoryPage() {
  const [items, setItems]         = useState<InventoryItem[]>([])
  const [distributors, setDist]   = useState<Distributor[]>([])
  const [meta, setMeta]           = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]     = useState(true)
  const [ownerFilter, setOwnerFilter] = useState('')
  const [typeFilter, setTypeFilter]   = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]           = useState('')
  const [page, setPage]               = useState(1)
  const [showAssign, setShowAssign]   = useState(false)

  // Inline edit
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editQty, setEditQty]       = useState('')
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [ownerFilter, typeFilter, search])

  const fetchItems = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      type: typeFilter, page: String(page), pageSize: String(PAGE_SIZE),
      ...(ownerFilter && { owner_id: ownerFilter }),
      ...(search && { search }),
    })
    fetch(`/api/admin/inventory?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.distributors?.length) setDist(data.distributors)
      })
      .finally(() => setLoading(false))
  }, [ownerFilter, typeFilter, page, search])

  useEffect(() => { fetchItems() }, [fetchItems])

  const stockStatus = (item: InventoryItem) => {
    if (item.quantity === 0)                           return { label: 'Out of stock', color: 'bg-[#fdecea] text-[#a03030]' }
    if (item.quantity <= item.low_stock_threshold)     return { label: 'Low stock',    color: 'bg-[#fef9ee] text-[#9a6f1e]' }
    return                                                    { label: 'In stock',     color: 'bg-[#e8f7ef] text-[#1a7a4a]' }
  }

  const handleSaveQty = async (id: string) => {
    setSaving(true)
    await fetch('/api/admin/inventory', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory_id: id, quantity: parseInt(editQty) }),
    })
    setSaving(false)
    setEditingId(null)
    fetchItems()
  }

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Inventory</h1>
          <p className="text-sm text-gray-400 mt-0.5">Stock levels across all distributors</p>
        </div>
        <button
          onClick={() => setShowAssign(true)}
          className="bg-[#C9A84C] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#b8963e] transition-colors font-medium"
        >
          + Assign Stock
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search product name..."
            className="flex-1 min-w-[180px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />

          {/* Distributor filter */}
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors"
          >
            <option value="">All distributors</option>
            {['regional', 'provincial', 'city'].map((role) => (
              <optgroup key={role} label={role.charAt(0).toUpperCase() + role.slice(1)}>
                {distributors.filter((d) => d.role === role).map((d) => (
                  <option key={d.id} value={d.id}>{d.full_name}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Type filter */}
          <div className="flex gap-1">
            {(['all', 'physical', 'digital'] as const).map((f) => (
              <button key={f} onClick={() => setTypeFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  typeFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}>{f}</button>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="grid grid-cols-6 px-4 py-2 bg-[#F0F2F8]">
          {['Distributor', 'Product', 'Type', 'Quantity', 'Low Stock Alert', 'Status'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No inventory found.</p>
            <p className="text-gray-300 text-xs mt-1">Use "+ Assign Stock" to add inventory to distributors.</p>
          </div>
        ) : (
          items.map((item) => {
            const status = stockStatus(item)
            const isEditing = editingId === item.id
            return (
              <div key={item.id}
                className="grid grid-cols-6 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center">

                {/* Owner */}
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{item.owner.full_name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${ROLE_COLOR[item.owner.role]}`}>
                    {item.owner.role}
                  </span>
                </div>

                {/* Product */}
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{item.product.name}</p>
                  <p className="text-xs text-gray-400">₱{Number(item.product.price).toLocaleString()}</p>
                </div>

                {/* Type */}
                <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${
                  item.product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'
                }`}>{item.product.type}</span>

                {/* Quantity — editable */}
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <input type="number" value={editQty} min={0}
                        onChange={(e) => setEditQty(e.target.value)}
                        className="w-16 bg-[#F0F2F8] border border-[#C9A84C] rounded px-2 py-1 text-xs text-[#0D1B3E] outline-none" />
                      <button onClick={() => handleSaveQty(item.id)} disabled={saving}
                        className="text-xs text-[#1a7a4a] font-medium hover:underline disabled:opacity-50">Save</button>
                      <button onClick={() => setEditingId(null)}
                        className="text-xs text-gray-400 hover:underline">Cancel</button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-[#0D1B3E]">{item.quantity.toLocaleString()}</p>
                      <button onClick={() => { setEditingId(item.id); setEditQty(String(item.quantity)) }}
                        className="text-xs text-[#C9A84C] hover:underline">Edit</button>
                    </>
                  )}
                </div>

                {/* Threshold */}
                <p className="text-xs text-gray-500">{item.low_stock_threshold} units</p>

                {/* Status */}
                <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${status.color}`}>
                  {status.label}
                </span>
              </div>
            )
          })
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {showAssign && (
        <AssignStockModal
          distributors={distributors}
          onClose={() => setShowAssign(false)}
          onSuccess={() => { setShowAssign(false); fetchItems() }}
        />
      )}
    </div>
  )
}