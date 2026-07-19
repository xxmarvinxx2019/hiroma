'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

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
    id:               string
    name:             string
    type:             string
    is_active:        boolean
    city_price:   number
    provincial_price: number
  }
}

const PAGE_SIZE = 15

const fmt  = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtS = (n: number) => {
  if (n >= 1000000) return `₱${(n/1000000).toFixed(2)}M`
  if (n >= 1000)    return `₱${(n/1000).toFixed(1)}K`
  return fmt(n)
}

function StockBar({ quantity, threshold }: { quantity: number; threshold: number }) {
  const max  = Math.max(threshold * 3, quantity, 1)
  const pct  = Math.min(100, Math.round((quantity / max) * 100))
  const isOut = quantity === 0
  const isLow = quantity > 0 && quantity <= threshold
  const color = isOut ? '#e05252' : isLow ? '#f59e0b' : '#1a7a4a'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-[#f1f5f9] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-semibold w-6 text-right" style={{ color }}>{pct}%</span>
    </div>
  )
}

export default function CityInventoryPage() {
  const [items, setItems]       = useState<InventoryItem[]>([])
  const [meta, setMeta]         = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]   = useState(true)
  const [typeFilter, setTypeFilter] = useState<'all' | 'physical' | 'digital'>('all')
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out' | 'ok'>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]     = useState('')
  const [page, setPage]         = useState(1)
  const [tab, setTab]           = useState<'inventory' | 'sales'>('inventory')
  const [productSales, setProductSales] = useState<ProductSale[]>([])
  const [summary, setSummary]   = useState({
    total_products: 0, low_stock: 0, out_of_stock: 0, total_units: 0,
    total_cost_value: 0, total_sell_value: 0, total_selling_value: 0, potential_profit: 0,
    actual_revenue: 0, actual_cost: 0, actual_profit: 0,
  })
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [editThreshold, setEditThreshold] = useState('')
  const [saving, setSaving]               = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search, typeFilter, stockFilter])

  const fetchInventory = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), type: typeFilter, search })
    if (stockFilter !== 'all') params.set('stock', stockFilter)
    fetch(`/api/city/inventory?${params}`)
      .then(r => r.json())
      .then(d => {
        setItems(d.items || [])
        setMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        setSummary(d.summary || {})
        setProductSales(d.productSales || d.product_sales || [])
      })
      .finally(() => setLoading(false))
  }, [page, search, typeFilter, stockFilter])

  useEffect(() => { fetchInventory() }, [fetchInventory])

  const saveThreshold = async (id: string) => {
    setSaving(true)
    await fetch('/api/city/inventory', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, low_stock_threshold: parseInt(editThreshold) }),
    })
    setSaving(false)
    setEditingId(null)
    fetchInventory()
  }

  const getStockStatus = (qty: number, threshold: number) => {
    if (qty === 0)            return { label: 'Out',  color: '#e05252', bg: '#fdecea' }
    if (qty <= threshold)     return { label: 'Low',  color: '#f59e0b', bg: '#fffbeb' }
    return                           { label: 'OK',   color: '#1a7a4a', bg: '#e8f7ef' }
  }

  return (
    <div className="w-full space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">Inventory</h1>
          <p className="text-xs text-gray-400 mt-0.5">Manage your city stock levels and product movement</p>
        </div>
        <div className="text-xs text-gray-400 bg-white border border-[#0D1B3E]/8 px-3 py-2 rounded-xl">
          Last updated: {new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Products',   value: summary.total_products,                      color: '#0D1B3E', icon: '📦', sub: `${summary.total_units.toLocaleString()} units in stock` },
          { label: 'Low Stock',        value: summary.low_stock,                           color: '#f59e0b', icon: '⚠️', sub: 'Below threshold', badge: summary.low_stock > 0 ? 'Restock soon' : undefined },
          { label: 'Out of Stock',     value: summary.out_of_stock,                        color: '#e05252', icon: '❌', sub: 'Need immediate restock', badge: summary.out_of_stock > 0 ? 'Urgent!' : undefined },
          { label: 'Stock Value',      value: fmtS(summary.total_sell_value || summary.total_selling_value || 0), color: '#1a7a4a', icon: '💰', sub: `Cost: ${fmtS(summary.total_cost_value)}` },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm transition-all"
            style={{ borderTop: `2px solid ${s.color}` }}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: s.color + '15' }}>
                {s.icon}
              </div>
              {s.badge && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: s.color + '15', color: s.color }}>{s.badge}</span>}
            </div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Revenue cards */}
      {summary.actual_revenue > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Actual Revenue', value: fmtS(summary.actual_revenue), color: '#2563eb', icon: '📈' },
            { label: 'Actual Cost',    value: fmtS(summary.actual_cost),    color: '#e05252', icon: '🏷️' },
            { label: 'Actual Profit',  value: fmtS(summary.actual_profit),  color: '#1a7a4a', icon: '💎',
              sub: summary.actual_revenue > 0 ? `${Math.round((summary.actual_profit / summary.actual_revenue) * 100)}% margin` : '' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm transition-all"
              style={{ borderTop: `2px solid ${s.color}` }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-400 uppercase tracking-wide">{s.label}</p>
                <span className="text-lg">{s.icon}</span>
              </div>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              {s.sub && <p className="text-[10px] text-gray-400 mt-1">{s.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        <button onClick={() => setTab('inventory')}
          className={`text-xs px-4 py-2 rounded-lg font-medium transition-all ${tab === 'inventory' ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
          📦 Stock Levels
        </button>
        <button onClick={() => setTab('sales')}
          className={`text-xs px-4 py-2 rounded-lg font-medium transition-all ${tab === 'sales' ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
          📊 Sales Movement
        </button>
      </div>

      {/* ── INVENTORY TAB ── */}
      {tab === 'inventory' && (
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#0D1B3E]/8">
            <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-xl px-3 py-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-300">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                placeholder="Search products..."
                className="flex-1 bg-transparent text-sm text-[#0D1B3E] outline-none placeholder:text-gray-300" />
            </div>
            <div className="flex gap-1">
              {(['all', 'physical', 'digital'] as const).map(f => (
                <button key={f} onClick={() => setTypeFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${typeFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#f8f9fc] text-gray-400 hover:text-[#0D1B3E]'}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {[
                { key: 'all', label: 'All' },
                { key: 'out', label: '❌ Out' },
                { key: 'low', label: '⚠️ Low' },
                { key: 'ok',  label: '✅ OK'  },
              ].map(f => (
                <button key={f.key} onClick={() => setStockFilter(f.key as any)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${stockFilter === f.key ? 'bg-[#0D1B3E] text-white' : 'bg-[#f8f9fc] text-gray-400 hover:text-[#0D1B3E]'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-6 px-4 py-2.5 bg-[#f8f9fc] border-b border-[#0D1B3E]/8">
            {['Product', 'Type', 'Stock', 'Level', 'Threshold', 'Status'].map(h => (
              <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
            ))}
          </div>

          {loading ? (
            <div className="flex flex-col items-center py-16">
              <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-gray-400 text-sm">Loading inventory...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <span className="text-4xl block mb-3">📦</span>
              <p className="text-gray-400 text-sm">No inventory items found</p>
            </div>
          ) : items.map(item => {
            const status = getStockStatus(item.quantity, item.low_stock_threshold)
            const isEditing = editingId === item.id
            return (
              <div key={item.id} className={`grid grid-cols-6 px-4 py-3.5 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors items-center ${!item.product.is_active ? 'opacity-50' : ''}`}>
                {/* Product */}
                <div>
                  <p className="text-xs font-semibold text-[#0D1B3E] truncate">{item.product.name}</p>
                  <p className="text-[10px] text-gray-400">{fmt(item.product.city_price)} / unit</p>
                </div>
                {/* Type */}
                <span className="text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-0.5 rounded-full capitalize font-medium w-fit">
                  {item.product.type}
                </span>
                {/* Stock */}
                <div>
                  <p className="text-sm font-bold" style={{ color: status.color }}>{item.quantity.toLocaleString()}</p>
                  <p className="text-[9px] text-gray-400">units</p>
                </div>
                {/* Level bar */}
                <StockBar quantity={item.quantity} threshold={item.low_stock_threshold} />
                {/* Threshold (editable) */}
                <div>
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input type="number" value={editThreshold}
                        onChange={e => setEditThreshold(e.target.value)}
                        className="w-14 text-xs border border-[#C9A84C] rounded-lg px-2 py-1 outline-none text-center"
                        autoFocus onKeyDown={e => e.key === 'Enter' && saveThreshold(item.id)} />
                      <button onClick={() => saveThreshold(item.id)} disabled={saving}
                        className="text-[10px] bg-[#1a7a4a] text-white px-1.5 py-1 rounded-lg hover:opacity-80">
                        {saving ? '...' : '✓'}
                      </button>
                      <button onClick={() => setEditingId(null)}
                        className="text-[10px] bg-[#f8f9fc] text-gray-400 px-1.5 py-1 rounded-lg hover:bg-gray-100">
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingId(item.id); setEditThreshold(String(item.low_stock_threshold)) }}
                      className="flex items-center gap-1 group">
                      <p className="text-xs text-gray-500">{item.low_stock_threshold}</p>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-300 group-hover:text-[#C9A84C] transition-colors">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  )}
                </div>
                {/* Status */}
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold w-fit"
                  style={{ background: status.bg, color: status.color }}>
                  {status.label}
                </span>
              </div>
            )
          })}

          <Pagination meta={meta} onPageChange={setPage} />
        </div>
      )}

      {/* ── SALES MOVEMENT TAB ── */}
      {tab === 'sales' && (
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
            <p className="text-sm font-bold text-[#0D1B3E]">Product Movement</p>
            <p className="text-xs text-gray-400 mt-0.5">Based on delivered orders</p>
          </div>
          <div className="grid grid-cols-6 px-5 py-2.5 bg-[#f8f9fc]">
            {['Product', 'Type', 'Units Sold', 'Revenue', 'Cost', 'Profit'].map(h => (
              <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
            ))}
          </div>
          {productSales.length === 0 ? (
            <div className="py-16 text-center">
              <span className="text-4xl block mb-3">📊</span>
              <p className="text-gray-400 text-sm">No sales data yet</p>
            </div>
          ) : productSales.map((p, i) => {
            const margin = p.revenue > 0 ? Math.round((p.profit / p.revenue) * 100) : 0
            const maxUnits = productSales[0]?.units_sold || 1
            const barPct = Math.round((p.units_sold / maxUnits) * 100)
            return (
              <div key={p.product_id || i} className="grid grid-cols-6 px-5 py-3.5 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center transition-colors">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: i === 0 ? '#C9A84C' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7f32' : '#f1f5f9', color: i < 3 ? 'white' : '#9ca3af' }}>
                    {i + 1}
                  </div>
                  <p className="text-xs font-semibold text-[#0D1B3E] truncate">{p.name}</p>
                </div>
                <span className="text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-0.5 rounded-full capitalize font-medium w-fit">{p.type}</span>
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <p className="text-xs font-bold text-[#0D1B3E]">{p.units_sold.toLocaleString()}</p>
                  </div>
                  <div className="w-full h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#C9A84C]" style={{ width: `${barPct}%` }} />
                  </div>
                </div>
                <p className="text-xs font-bold text-[#2563eb]">{fmtS(p.revenue)}</p>
                <p className="text-xs font-semibold text-[#e05252]">{fmtS(p.cost)}</p>
                <div>
                  <p className="text-xs font-bold text-[#1a7a4a]">{fmtS(p.profit)}</p>
                  <p className="text-[9px] text-gray-400">{margin}% margin</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}