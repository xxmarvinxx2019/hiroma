'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface ProductSale {
  product_id: string; name: string; type: string
  units_sold: number; revenue: number; cost: number; profit: number
}

interface InventoryItem {
  id: string
  quantity: number
  low_stock_threshold: number
  updated_at: string
  product: {
    id:             string
    name:           string
    type:           string
    is_active:      boolean
    provincial_price:   number
    city_price: number
  }
}

const PAGE_SIZE = 15

// ============================================================
// PAGE
// ============================================================

export default function ProvincialInventoryPage() {
  const [items, setItems]     = useState<InventoryItem[]>([])
  const [meta, setMeta]       = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<'all' | 'physical' | 'digital'>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)

  const [tab, setTab] = useState<'inventory' | 'sales'>('inventory')
  const [productSales, setProductSales] = useState<ProductSale[]>([])
  const [summary, setSummary] = useState({
    total_products: 0, low_stock: 0, out_of_stock: 0, total_units: 0,
    total_cost_value: 0, total_sell_value: 0, potential_profit: 0,
    actual_revenue: 0, actual_cost: 0, actual_profit: 0,
  })

  // Threshold edit state
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [editThreshold, setEditThreshold] = useState('')
  const [saving, setSaving]               = useState(false)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [typeFilter, search])

  const fetchItems = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      type: typeFilter, page: String(page), pageSize: String(PAGE_SIZE),
      ...(search && { search }),
    })
    fetch(`/api/provincial/inventory?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.summary)      setSummary(data.summary)
        if (data.productSales) setProductSales(data.productSales)
      })
      .finally(() => setLoading(false))
  }, [typeFilter, page, search])

  useEffect(() => { fetchItems() }, [fetchItems])

  const stockStatus = (item: InventoryItem) => {
    if (item.quantity === 0)                             return { label: 'Out of stock', color: 'bg-[#fdecea] text-[#a03030]' }
    if (item.quantity <= item.low_stock_threshold)       return { label: 'Low stock',    color: 'bg-[#fef9ee] text-[#9a6f1e]' }
    return                                                      { label: 'In stock',     color: 'bg-[#e8f7ef] text-[#1a7a4a]' }
  }

  const handleSaveThreshold = async (id: string) => {
    setSaving(true)
    const res = await fetch('/api/provincial/inventory', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inventory_id: id, low_stock_threshold: editThreshold }),
    })
    setSaving(false)
    if (res.ok) { setEditingId(null); fetchItems() }
  }

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Inventory</h1>
        <p className="text-sm text-gray-400 mt-0.5">Stock levels for your coverage area</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        {([
          { key: 'inventory', label: '📦 Inventory' },
          { key: 'sales',     label: '📊 Product Sales' },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === t.key ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inventory' && (<>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Products', value: summary.total_products, accent: 'navy' },
          { label: 'Total Units',    value: summary.total_units,    accent: 'navy' },
          { label: 'Low Stock',      value: summary.low_stock,      accent: 'gold' },
          { label: 'Out of Stock',   value: summary.out_of_stock,   accent: 'red'  },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent === 'gold' ? '#C9A84C' : s.accent === 'red' ? '#e05252' : '#0D1B3E'}` }}
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold"
              style={{ color: s.accent === 'gold' ? '#C9A84C' : s.accent === 'red' ? '#e05252' : '#0D1B3E' }}>
              {s.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Search & Filter */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search product name..."
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

        {/* Header */}
        <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
          {['Product', 'Type', 'Quantity', 'Low Stock Alert', 'Status'].map((h) => (
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
          <div className="px-4 py-12 text-center text-gray-400 text-sm">No inventory items found</div>
        ) : (
          items.map((item) => {
            const status = stockStatus(item)
            const isEditing = editingId === item.id
            return (
              <div
                key={item.id}
                className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
              >
                {/* Product */}
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{item.product.name}</p>
                  <p className="text-xs text-gray-400">Cost: ₱{Number(item.product.provincial_price).toLocaleString()} · Sell: ₱{Number(item.product.city_price).toLocaleString()}</p>
                </div>

                {/* Type */}
                <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${
                  item.product.type === 'physical'
                    ? 'bg-[#eef0f8] text-[#0D1B3E]'
                    : 'bg-[#f0f7ff] text-[#2563eb]'
                }`}>
                  {item.product.type}
                </span>

                {/* Quantity */}
                <p className="text-sm font-semibold text-[#0D1B3E]">{item.quantity.toLocaleString()}</p>

                {/* Low stock threshold - editable */}
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <input
                        type="number"
                        value={editThreshold}
                        onChange={(e) => setEditThreshold(e.target.value)}
                        className="w-16 bg-[#F0F2F8] border border-[#C9A84C] rounded px-2 py-1 text-xs text-[#0D1B3E] outline-none"
                        min={0}
                      />
                      <button
                        onClick={() => handleSaveThreshold(item.id)}
                        disabled={saving}
                        className="text-xs text-[#1a7a4a] font-medium hover:underline disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-400 hover:underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500">{item.low_stock_threshold} units</p>
                      <button
                        onClick={() => { setEditingId(item.id); setEditThreshold(String(item.low_stock_threshold)) }}
                        className="text-xs text-[#C9A84C] hover:underline"
                      >
                        Edit
                      </button>
                    </>
                  )}
                </div>

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

      </>)}

      {/* Financial Summary */}
      {tab === 'inventory' && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          {[
            { label: 'Stock at Provincial Price',    value: summary.total_cost_value,  accent: '#0D1B3E', hint: 'What you paid (provincial price)' },
            { label: 'Stock at City Dist Price', value: summary.total_sell_value,  accent: '#2563eb', hint: 'What city distributors pay you' },
            { label: 'Potential Profit',                value: summary.potential_profit,  accent: '#1a7a4a', hint: 'If all current stock is sold' },
            { label: 'Total Sales',                     value: summary.actual_revenue,    accent: '#2563eb', hint: 'What buyers paid you (delivered orders)' },
            { label: 'Total Cost',                      value: summary.actual_cost,       accent: '#e05252', hint: 'What you paid for goods already sold' },
            { label: 'Actual Profit',                   value: summary.actual_profit,     accent: '#1a7a4a', hint: 'Sales minus cost of goods sold' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
              style={{ borderTop: `2px solid ${s.accent}` }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
              <p className="text-xl font-semibold" style={{ color: s.accent }}>₱{Number(s.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{s.hint}</p>
            </div>
          ))}
        </div>
      )}

      {/* Product Sales Tab */}
      {tab === 'sales' && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
            <p className="text-sm font-semibold text-[#0D1B3E]">Products Sold</p>
            <p className="text-xs text-gray-400 mt-0.5">Based on all your delivered orders</p>
          </div>
          <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
            {['Product', 'Units Sold', 'Revenue', 'Cost', 'Profit'].map((h) => (
              <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
            ))}
          </div>
          {productSales.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">No delivered orders yet.</p>
          ) : (
            productSales.map((p, i) => (
              <div key={p.product_id} className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 items-center">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: i === 0 ? '#C9A84C' : '#F0F2F8', color: i === 0 ? '#0D1B3E' : '#8892a4' }}>
                    {i + 1}
                  </span>
                  <p className="text-xs font-medium text-[#0D1B3E] truncate">{p.name}</p>
                </div>
                <p className="text-xs font-semibold text-[#0D1B3E]">{p.units_sold.toLocaleString()}</p>
                <p className="text-xs font-semibold text-[#2563eb]">₱{p.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs text-[#e05252]">₱{p.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-xs font-semibold text-[#1a7a4a]">₱{p.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            ))
          )}
          {productSales.length > 0 && (
            <div className="grid grid-cols-5 px-4 py-3 bg-[#F0F2F8] font-semibold border-t border-[#0D1B3E]/8">
              <p className="text-xs text-[#0D1B3E]">TOTAL</p>
              <p className="text-xs text-[#0D1B3E]">{productSales.reduce((s, p) => s + p.units_sold, 0).toLocaleString()}</p>
              <p className="text-xs text-[#2563eb]">₱{productSales.reduce((s, p) => s + p.revenue, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="text-xs text-[#e05252]">₱{productSales.reduce((s, p) => s + p.cost, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="text-xs text-[#1a7a4a]">₱{productSales.reduce((s, p) => s + p.profit, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          )}
        </div>
      )}

    </div>
  )
}