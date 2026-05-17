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
  product: {
    id: string; name: string; type: string
    regional_price: number; provincial_price: number; city_price: number
  }
}

interface Distributor {
  id: string; full_name: string; username: string; role: string
}

interface ProductStock {
  id: string; name: string; type: string
  cost_price: number; regional_price: number; provincial_price: number
  city_price: number; reseller_price: number
  total_distributed: number; is_low_stock: boolean; admin_stock: number
}

interface CartItem {
  product: ProductStock
  quantity: number
}

const PAGE_SIZE = 15

const ROLE_COLOR: Record<string, string> = {
  regional:   'bg-[#f0f7ff] text-[#2563eb]',
  provincial: 'bg-[#fef9ee] text-[#9a6f1e]',
  city:       'bg-[#e8f7ef] text-[#1a7a4a]',
}

const PRICE_KEY: Record<string, keyof ProductStock> = {
  regional:   'regional_price',
  provincial: 'provincial_price',
  city:       'city_price',
}

const PRICE_LABEL: Record<string, string> = {
  regional:   'Regional Price',
  provincial: 'Provincial Price',
  city:       'City Price',
}

// ============================================================
// ADD PRODUCTION MODAL — admin adds to their own stock
// ============================================================

function AddProductionModal({
  products,
  onClose,
  onSuccess,
}: {
  products:  ProductStock[]
  onClose:   () => void
  onSuccess: () => void
}) {
  const [cart, setCart]             = useState<CartItem[]>([])
  const [notes, setNotes]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [success, setSuccess]       = useState('')
  const [search, setSearch]         = useState('')

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const addToCart = (product: ProductStock) => {
    setCart((prev) => {
      const ex = prev.find((c) => c.product.id === product.id)
      if (ex) return prev.map((c) => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { product, quantity: 1 }]
    })
  }

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) setCart((prev) => prev.filter((c) => c.product.id !== productId))
    else setCart((prev) => prev.map((c) => c.product.id === productId ? { ...c, quantity: qty } : c))
  }

  const handleSubmit = async () => {
    if (cart.length === 0) { setError('Add at least one product.'); return }
    setSubmitting(true); setError('')
    const res = await fetch('/api/admin/inventory', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes,
        items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })),
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) {
      setSuccess(data.message || 'Stock added successfully.')
      setTimeout(() => { onSuccess(); onClose() }, 1500)
    } else {
      setError(data.error || 'Something went wrong.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Add Production / Received Stock</h2>
            <p className="text-xs text-gray-400 mt-0.5">Add to your own inventory — stock you manufactured or received</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left — products */}
          <div className="flex-1 flex flex-col border-r border-[#0D1B3E]/8 min-w-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.map((product) => {
                const inCart = cart.find((c) => c.product.id === product.id)
                return (
                  <div key={product.id}
                    className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50">
                    <div>
                      <p className="text-xs font-medium text-[#0D1B3E]">{product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>{product.type}</span>
                        <span className="text-[10px] text-gray-400">Cost: ₱{Number(product.cost_price).toLocaleString()}</span>
                        <span className="text-[10px] text-gray-300">· In stock: {product.admin_stock}</span>
                      </div>
                    </div>
                    <button onClick={() => addToCart(product)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${inCart ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#0D1B3E] text-white hover:bg-[#162850]'}`}>
                      {inCart ? `✓ ${inCart.quantity}` : '+ Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right — cart */}
          <div className="w-56 flex flex-col flex-shrink-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <p className="text-xs font-semibold text-[#0D1B3E]">Stock to Add</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
              {cart.length === 0 ? (
                <p className="text-xs text-gray-400 text-center pt-4">No items yet</p>
              ) : (
                cart.map((c) => (
                  <div key={c.product.id} className="text-xs">
                    <p className="font-medium text-[#0D1B3E] truncate">{c.product.name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <button onClick={() => updateQty(c.product.id, c.quantity - 1)}
                        className="w-5 h-5 bg-[#F0F2F8] rounded font-bold flex items-center justify-center flex-shrink-0">−</button>
                      <input type="number" min={1} value={c.quantity}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) updateQty(c.product.id, v) }}
                        className="w-10 text-center text-xs bg-[#F0F2F8] rounded border border-[#0D1B3E]/15 outline-none focus:border-[#C9A84C] py-0.5" />
                      <button onClick={() => updateQty(c.product.id, c.quantity + 1)}
                        className="w-5 h-5 bg-[#F0F2F8] rounded font-bold flex items-center justify-center flex-shrink-0">+</button>
                      <span className="ml-auto text-gray-400">{c.quantity} units</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-[#0D1B3E]/8 flex-shrink-0 space-y-3">
              <div className="flex justify-between text-xs font-semibold text-[#0D1B3E]">
                <span>Total Units</span>
                <span>{cart.reduce((s, c) => s + c.quantity, 0).toLocaleString()}</span>
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes e.g. 'Batch #12 production run'" rows={2}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#C9A84C] resize-none placeholder:text-gray-400" />
              {error   && <p className="text-xs text-[#a03030]">{error}</p>}
              {success && <p className="text-xs text-[#1a7a4a] bg-[#e8f7ef] px-2 py-1.5 rounded-lg">{success}</p>}
              <button onClick={handleSubmit} disabled={submitting || cart.length === 0}
                className="w-full bg-[#0D1B3E] text-white text-xs py-2 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-50 font-medium">
                {submitting ? 'Adding...' : 'Add to My Stock'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// ASSIGN STOCK MODAL
// ============================================================

function AssignStockModal({
  distributors,
  products,
  onClose,
  onSuccess,
}: {
  distributors: Distributor[]
  products:     ProductStock[]
  onClose:      () => void
  onSuccess:    () => void
}) {
  const [ownerId, setOwnerId]       = useState('')
  const [cart, setCart]             = useState<CartItem[]>([])
  const [notes, setNotes]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [success, setSuccess]       = useState('')
  const [search, setSearch]         = useState('')

  const selectedDist = distributors.find((d) => d.id === ownerId)
  const priceKey     = selectedDist ? PRICE_KEY[selectedDist.role] : null

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const addToCart = (product: ProductStock) => {
    setCart((prev) => {
      const ex = prev.find((c) => c.product.id === product.id)
      if (ex) return prev.map((c) => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { product, quantity: 1 }]
    })
  }

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) setCart((prev) => prev.filter((c) => c.product.id !== productId))
    else setCart((prev) => prev.map((c) => c.product.id === productId ? { ...c, quantity: qty } : c))
  }

  const total = priceKey
    ? cart.reduce((s, c) => s + Number(c.product[priceKey]) * c.quantity, 0)
    : 0

  const handleSubmit = async () => {
    if (!ownerId)          { setError('Please select a distributor.'); return }
    if (cart.length === 0) { setError('Add at least one product.'); return }
    setSubmitting(true); setError('')

    const res = await fetch('/api/admin/inventory', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_id: ownerId,
        notes,
        items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })),
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) {
      setSuccess(data.message || 'Stock assigned successfully.')
      setTimeout(() => { onSuccess(); onClose() }, 1500)
    } else {
      setError(data.error || 'Something went wrong.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Assign Stock to Distributor</h2>
            <p className="text-xs text-gray-400 mt-0.5">Priced at distributor's level — recorded as a delivered order</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left — products */}
          <div className="flex-1 flex flex-col border-r border-[#0D1B3E]/8 min-w-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0 space-y-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Distributor *</label>
                <select value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setCart([]) }}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
                  <option value="">Select distributor...</option>
                  {(['regional', 'provincial', 'city'] as const).map((role) => (
                    <optgroup key={role} label={role.charAt(0).toUpperCase() + role.slice(1)}>
                      {distributors.filter((d) => d.role === role).map((d) => (
                        <option key={d.id} value={d.id}>{d.full_name} (@{d.username})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedDist && (
                  <p className="text-[10px] text-[#C9A84C] mt-0.5">
                    Pricing at <strong>{PRICE_LABEL[selectedDist.role]}</strong>
                  </p>
                )}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..." disabled={!ownerId}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400 disabled:opacity-50" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {!ownerId ? (
                <p className="text-center text-xs text-gray-400 py-8">Select a distributor first</p>
              ) : filtered.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-8">No products found</p>
              ) : (
                filtered.map((product) => {
                  const price  = priceKey ? Number(product[priceKey]) : 0
                  const inCart = cart.find((c) => c.product.id === product.id)
                  return (
                    <div key={product.id}
                      className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50">
                      <div>
                        <p className="text-xs font-medium text-[#0D1B3E]">{product.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>{product.type}</span>
                          <span className="text-xs font-medium text-[#C9A84C]">₱{price.toLocaleString()}</span>
                          <span className="text-[10px] text-gray-400">cost: ₱{Number(product.cost_price).toLocaleString()}</span>
                        </div>
                      </div>
                      <button onClick={() => addToCart(product)}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          inCart
                            ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                            : 'bg-[#0D1B3E] text-white hover:bg-[#162850]'
                        }`}>
                        {inCart ? `✓ ${inCart.quantity}` : '+ Add'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right — cart */}
          <div className="w-56 flex flex-col flex-shrink-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <p className="text-xs font-semibold text-[#0D1B3E]">Order Summary</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
              {cart.length === 0 ? (
                <p className="text-xs text-gray-400 text-center pt-4">No items yet</p>
              ) : (
                cart.map((c) => {
                  const price = priceKey ? Number(c.product[priceKey]) : 0
                  return (
                    <div key={c.product.id} className="text-xs">
                      <p className="font-medium text-[#0D1B3E] truncate">{c.product.name}</p>
                      <p className="text-[10px] text-gray-400">₱{price.toLocaleString()} each</p>
                      <div className="flex items-center gap-1 mt-1">
                        <button onClick={() => updateQty(c.product.id, c.quantity - 1)}
                          className="w-5 h-5 bg-[#F0F2F8] rounded font-bold flex items-center justify-center flex-shrink-0">−</button>
                        <input type="number" min={1} value={c.quantity}
                          onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) updateQty(c.product.id, v) }}
                          className="w-10 text-center text-xs bg-[#F0F2F8] rounded border border-[#0D1B3E]/15 outline-none focus:border-[#C9A84C] py-0.5" />
                        <button onClick={() => updateQty(c.product.id, c.quantity + 1)}
                          className="w-5 h-5 bg-[#F0F2F8] rounded font-bold flex items-center justify-center flex-shrink-0">+</button>
                        <span className="ml-auto text-gray-500">₱{(price * c.quantity).toLocaleString()}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="px-4 py-3 border-t border-[#0D1B3E]/8 flex-shrink-0 space-y-3">
              <div className="flex justify-between text-xs font-semibold text-[#0D1B3E]">
                <span>Total</span>
                <span>₱{total.toLocaleString()}</span>
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)" rows={2}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#C9A84C] resize-none placeholder:text-gray-400" />
              {error   && <p className="text-xs text-[#a03030]">{error}</p>}
              {success && <p className="text-xs text-[#1a7a4a] bg-[#e8f7ef] px-2 py-1.5 rounded-lg">{success}</p>}
              <button onClick={handleSubmit} disabled={submitting || cart.length === 0 || !ownerId}
                className="w-full bg-[#C9A84C] text-white text-xs py-2 rounded-lg hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium">
                {submitting ? 'Assigning...' : 'Assign Stock & Record Sale'}
              </button>
            </div>
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
  const [tab, setTab]                   = useState<'stock' | 'distributed'>('stock')
  const [stockPage, setStockPage]       = useState(1)
  const [stockSearch, setStockSearch]   = useState('')
  const [stockSearchInput, setStockSearchInput] = useState('')
  const [stockMeta, setStockMeta]       = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [items, setItems]               = useState<InventoryItem[]>([])
  const [productStock, setProductStock] = useState<ProductStock[]>([])
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [meta, setMeta]                 = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]           = useState(true)
  const [ownerFilter, setOwnerFilter]   = useState('')
  const [searchInput, setSearchInput]   = useState('')
  const [search, setSearch]             = useState('')
  const [typeFilter, setTypeFilter]     = useState('all')
  const [page, setPage]                 = useState(1)
  const [showAssign, setShowAssign]       = useState(false)
  const [showProduction, setShowProduction] = useState(false)
  const [editingId, setEditingId]       = useState<string | null>(null)
  const [editThreshold, setEditThreshold] = useState('')
  const [saving, setSaving]             = useState(false)
  const [adminRevenue, setAdminRevenue]         = useState(0)
  const [adminTotalOrders, setAdminTotalOrders] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [ownerFilter, search, typeFilter, tab])

  useEffect(() => {
    const t = setTimeout(() => setStockSearch(stockSearchInput), 400)
    return () => clearTimeout(t)
  }, [stockSearchInput])

  useEffect(() => { setStockPage(1) }, [stockSearch])

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page:      String(page),
      pageSize:  String(PAGE_SIZE),
      stockPage: String(stockPage),
      ...(ownerFilter  && { owner_id: ownerFilter }),
      ...(search       && { search }),
      ...(stockSearch  && { stock_search: stockSearch }),
      ...(typeFilter !== 'all' && { type: typeFilter }),
    })
    fetch(`/api/admin/inventory?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || [])
        setDistributors(data.distributors || [])
        setProductStock(data.productStockSummary || [])
        setAdminRevenue(data.adminRevenue || 0)
        setAdminTotalOrders(data.adminTotalOrders || 0)
        if (data.meta)      setMeta(data.meta)
        if (data.stockMeta) setStockMeta(data.stockMeta)
      })
      .finally(() => setLoading(false))
  }, [page, stockPage, ownerFilter, search, stockSearch, typeFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSaveThreshold = async (inventoryId: string) => {
    setSaving(true)
    await fetch('/api/admin/inventory', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory_id: inventoryId, low_stock_threshold: editThreshold }),
    })
    setSaving(false)
    setEditingId(null)
    fetchData()
  }

  const lowStockCount  = productStock.filter((p) => p.is_low_stock).length
  const totalDistUnits = productStock.reduce((s, p) => s + p.total_distributed, 0)

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Inventory Management</h1>
          <p className="text-sm text-gray-400 mt-0.5">Assign stock to distributors — each assignment is recorded as a sale</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowProduction(true)}
            className="bg-[#0D1B3E] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#162850] transition-colors font-medium">
            + Add Production
          </button>
          <button onClick={() => setShowAssign(true)}
            className="bg-[#C9A84C] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#b8963e] transition-colors font-medium">
            + Assign Stock
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Revenue',     value: `₱${adminRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, accent: '#1a7a4a' },
          { label: 'Stock Assignments', value: adminTotalOrders.toLocaleString(),  accent: '#2563eb' },
          { label: 'Units Distributed', value: totalDistUnits.toLocaleString(),    accent: '#0D1B3E' },
          {
            label: 'Low Stock Alerts',
            value: lowStockCount.toLocaleString(),
            accent: lowStockCount > 0 ? '#e05252' : '#1a7a4a',
          },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        {([
          { key: 'stock',       label: '📦 Product Stock Overview' },
          { key: 'distributed', label: '📋 Distributor Inventory' },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === t.key ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PRODUCT STOCK OVERVIEW ── */}
      {tab === 'stock' && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8 gap-4">
            <div>
              <p className="text-sm font-semibold text-[#0D1B3E]">Product Stock Summary</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Total units distributed — <span className="text-[#e05252] font-medium">red = low stock</span>
              </p>
            </div>
            <input
              value={stockSearchInput}
              onChange={(e) => setStockSearchInput(e.target.value)}
              placeholder="Search products..."
              className="bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400 w-60"
            />
          </div>
          <div className="grid grid-cols-8 px-4 py-2 bg-[#F0F2F8]">
            {['Product', 'Cost', 'Regional ₱', 'Provincial ₱', 'City ₱', 'Reseller ₱', 'Admin Stock', 'Distributed'].map((h) => (
              <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
            ))}
          </div>
          {productStock.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">No products found.</p>
          ) : (
            productStock.map((p) => (
              <div key={p.id}
                className={`grid grid-cols-8 px-4 py-3 border-b border-[#0D1B3E]/5 items-center transition-colors ${
                  p.is_low_stock ? 'bg-[#fdecea]/30' : 'hover:bg-[#F0F2F8]/50'
                }`}>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-[#0D1B3E]">{p.name}</p>
                    {p.is_low_stock && (
                      <span className="text-[10px] bg-[#fdecea] text-[#e05252] px-1.5 py-0.5 rounded-full font-medium">⚠ Low</span>
                    )}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>
                    {p.type}
                  </span>
                </div>
                <p className="text-xs text-gray-500">₱{Number(p.cost_price).toLocaleString()}</p>
                <p className="text-xs text-[#2563eb]">₱{Number(p.regional_price).toLocaleString()}</p>
                <p className="text-xs text-[#9a6f1e]">₱{Number(p.provincial_price).toLocaleString()}</p>
                <p className="text-xs text-[#1a7a4a]">₱{Number(p.city_price).toLocaleString()}</p>
                <p className="text-xs text-[#C9A84C]">₱{Number(p.reseller_price).toLocaleString()}</p>
                <div>
                  <p className={`text-sm font-semibold ${
                    p.admin_stock === 0 ? 'text-[#e05252]' : p.admin_stock <= 10 ? 'text-[#9a6f1e]' : 'text-[#1a7a4a]'
                  }`}>
                    {p.admin_stock.toLocaleString()}
                    <span className="text-xs font-normal text-gray-400 ml-1">units</span>
                  </p>
                  {p.admin_stock === 0 && <p className="text-[10px] text-[#e05252]">⚠ Manufacture now</p>}
                  {p.admin_stock > 0 && p.admin_stock <= 10 && <p className="text-[10px] text-[#9a6f1e]">⚠ Running low</p>}
                </div>
                <div>
                  <p className={`text-sm font-semibold ${p.total_distributed === 0 ? 'text-gray-300' : 'text-[#0D1B3E]'}`}>
                    {p.total_distributed.toLocaleString()}
                    <span className="text-xs font-normal text-gray-400 ml-1">units</span>
                  </p>
                </div>
              </div>
            ))
          )}
          <Pagination meta={stockMeta} onPageChange={setStockPage} />
        </div>
      )}

      {/* ── DISTRIBUTOR INVENTORY ── */}
      {tab === 'distributed' && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
              className="bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
              <option value="">All distributors</option>
              {(['regional', 'provincial', 'city'] as const).map((role) => (
                <optgroup key={role} label={role.charAt(0).toUpperCase() + role.slice(1)}>
                  {distributors.filter((d) => d.role === role).map((d) => (
                    <option key={d.id} value={d.id}>{d.full_name} (@{d.username})</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search products..."
              className="flex-1 min-w-[180px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />
            <div className="flex gap-1">
              {(['all', 'physical', 'digital'] as const).map((f) => (
                <button key={f} onClick={() => setTypeFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${typeFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Header */}
          <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
            {['Distributor', 'Product', 'Stock', 'Alert Threshold', 'Action'].map((h) => (
              <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
            ))}
          </div>

          {/* Rows */}
          {loading ? (
            <div className="px-4 py-12 text-center">
              <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">No inventory records found.</p>
          ) : (
            items.map((item) => {
              const isLow  = item.quantity <= item.low_stock_threshold
              const isEdit = editingId === item.id
              const price  = item.owner.role === 'regional'
                ? item.product.regional_price
                : item.owner.role === 'provincial'
                ? item.product.provincial_price
                : item.product.city_price
              return (
                <div key={item.id}
                  className={`grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 items-center ${isLow ? 'bg-[#fdecea]/20' : 'hover:bg-[#F0F2F8]/50'}`}>
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">{item.owner.full_name}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${ROLE_COLOR[item.owner.role] || ''}`}>
                      {item.owner.role}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">{item.product.name}</p>
                    <p className="text-[10px] text-gray-400">₱{Number(price).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${isLow ? 'text-[#e05252]' : 'text-[#0D1B3E]'}`}>
                      {item.quantity.toLocaleString()}
                    </p>
                    {isLow && <p className="text-[10px] text-[#e05252] font-medium">⚠ Restock needed</p>}
                  </div>
                  <div>
                    {isEdit ? (
                      <div className="flex items-center gap-1">
                        <input type="number" value={editThreshold} onChange={(e) => setEditThreshold(e.target.value)}
                          className="w-16 bg-[#F0F2F8] border border-[#C9A84C] rounded px-2 py-1 text-xs outline-none" />
                        <button onClick={() => handleSaveThreshold(item.id)} disabled={saving}
                          className="text-xs text-white bg-[#0D1B3E] px-2 py-1 rounded disabled:opacity-50">
                          {saving ? '...' : 'Save'}
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 px-1">✕</button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">{item.low_stock_threshold} units</p>
                    )}
                  </div>
                  <button
                    onClick={() => { setEditingId(item.id); setEditThreshold(String(item.low_stock_threshold)) }}
                    className="text-xs text-[#C9A84C] hover:underline">
                    Set Alert
                  </button>
                </div>
              )
            })
          )}
          <Pagination meta={meta} onPageChange={setPage} />
        </div>
      )}

      {/* Add Production Modal */}
      {showProduction && (
        <AddProductionModal
          products={productStock}
          onClose={() => setShowProduction(false)}
          onSuccess={() => fetchData()}
        />
      )}

      {/* Assign Modal */}
      {showAssign && (
        <AssignStockModal
          distributors={distributors}
          products={productStock}
          onClose={() => setShowAssign(false)}
          onSuccess={() => fetchData()}
        />
      )}
    </div>
  )
}