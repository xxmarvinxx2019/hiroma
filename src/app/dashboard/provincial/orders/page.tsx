'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface OrderItem {
  quantity: number
  unit_price: number
  subtotal: number
  product: { name: string; type: string }
}

interface Order {
  id: string
  order_type: string
  status: string
  total_amount: number
  created_at: string
  notes: string | null
  buyer:  { full_name: string; username: string; role: string }
  seller: { full_name: string; username: string; role: string }
  items: OrderItem[]
}

interface Supplier {
  id: string
  full_name: string
  username: string
  level: string
}

interface Product {
  id: string
  name: string
  type: string
  price: number
}

interface CartItem {
  product: Product
  quantity: number
}

const PAGE_SIZE = 15

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-[#fef9ee] text-[#9a6f1e]',
  processing: 'bg-[#eef0f8] text-[#0D1B3E]',
  delivered:  'bg-[#e8f7ef] text-[#1a7a4a]',
  cancelled:  'bg-[#fdecea] text-[#a03030]',
}

const STATUS_NEXT: Record<string, string[]> = {
  pending:    ['processing', 'cancelled'],
  processing: ['delivered',  'cancelled'],
  delivered:  [],
  cancelled:  [],
}

// ============================================================
// CREATE ORDER MODAL
// ============================================================

function CreateOrderModal({
  supplier,
  onClose,
  onSuccess,
}: {
  supplier: Supplier
  onClose: () => void
  onSuccess: () => void
}) {
  const [products, setProducts]     = useState<Product[]>([])
  const [cart, setCart]             = useState<CartItem[]>([])
  const [orderType, setOrderType]   = useState<'online' | 'offline'>('online')
  const [notes, setNotes]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [search, setSearch]         = useState('')

  useEffect(() => {
    fetch('/api/provincial/products')
      .then((r) => r.json())
      .then((data) => setProducts(data.products || []))
  }, [])

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id)
      if (existing) return prev.map((c) => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { product, quantity: 1 }]
    })
  }

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) setCart((prev) => prev.filter((c) => c.product.id !== productId))
    else setCart((prev) => prev.map((c) => c.product.id === productId ? { ...c, quantity: qty } : c))
  }

  const total = cart.reduce((s, c) => s + c.product.price * c.quantity, 0)

  const handleSubmit = async () => {
    if (cart.length === 0) { setError('Add at least one item.'); return }
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/provincial/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_type: orderType,
        notes,
        items: cart.map((c) => ({
          product_id: c.product.id,
          quantity:   c.quantity,
          unit_price: c.product.price,
        })),
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) { onSuccess() }
    else { setError(data.error || 'Something went wrong.') }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Place New Order</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Ordering from: <span className="text-[#C9A84C] font-medium">{supplier.level} — {supplier.full_name}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-1 min-h-0">

          {/* Left — product picker */}
          <div className="flex-1 flex flex-col border-r border-[#0D1B3E]/8 min-w-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-8">No products found</p>
              ) : (
                filtered.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors"
                  >
                    <div>
                      <p className="text-xs font-medium text-[#0D1B3E]">{product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'
                        }`}>{product.type}</span>
                        <span className="text-xs text-gray-400">₱{Number(product.price).toLocaleString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => addToCart(product)}
                      className="text-xs bg-[#0D1B3E] text-white px-3 py-1.5 rounded-lg hover:bg-[#162850] transition-colors"
                    >
                      + Add
                    </button>
                  </div>
                ))
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
                cart.map((c) => (
                  <div key={c.product.id} className="text-xs">
                    <p className="font-medium text-[#0D1B3E] truncate">{c.product.name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <button onClick={() => updateQty(c.product.id, c.quantity - 1)}
                        className="w-5 h-5 bg-[#F0F2F8] rounded text-[#0D1B3E] font-bold text-xs flex items-center justify-center">−</button>
                      <span className="w-6 text-center text-[#0D1B3E]">{c.quantity}</span>
                      <button onClick={() => updateQty(c.product.id, c.quantity + 1)}
                        className="w-5 h-5 bg-[#F0F2F8] rounded text-[#0D1B3E] font-bold text-xs flex items-center justify-center">+</button>
                      <span className="ml-auto text-gray-400">₱{(c.product.price * c.quantity).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Total + options */}
            <div className="px-4 py-3 border-t border-[#0D1B3E]/8 flex-shrink-0 space-y-3">
              <div className="flex justify-between text-xs font-semibold text-[#0D1B3E]">
                <span>Total</span>
                <span>₱{total.toLocaleString()}</span>
              </div>

              {/* Order type */}
              <div className="flex gap-1">
                {(['online', 'offline'] as const).map((t) => (
                  <button key={t} onClick={() => setOrderType(t)}
                    className={`flex-1 text-xs py-1.5 rounded-lg capitalize transition-colors ${
                      orderType === t ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400'
                    }`}>{t}</button>
                ))}
              </div>

              {/* Notes */}
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                rows={2}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400 resize-none"
              />

              {error && <p className="text-xs text-[#a03030]">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={submitting || cart.length === 0}
                className="w-full bg-[#C9A84C] text-white text-xs py-2 rounded-lg hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium"
              >
                {submitting ? 'Placing...' : 'Place Order'}
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

export default function ProvincialOrdersPage() {
  const [tab, setTab]           = useState<'my_orders' | 'city_orders'>('my_orders')
  const [orders, setOrders]     = useState<Order[]>([])
  const [meta, setMeta]         = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]   = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter]     = useState('all')
  const [searchInput, setSearchInput]   = useState('')
  const [search, setSearch]             = useState('')
  const [page, setPage]                 = useState(1)
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [updatingId, setUpdatingId]     = useState<string | null>(null)
  const [supplier, setSupplier]         = useState<Supplier | null>(null)
  const [showCreate, setShowCreate]     = useState(false)

  const [summary, setSummary] = useState({
    total: 0, pending: 0, processing: 0, delivered: 0, cancelled: 0,
  })

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [tab, statusFilter, typeFilter, search])

  const fetchOrders = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      tab, status: statusFilter, type: typeFilter,
      page: String(page), pageSize: String(PAGE_SIZE),
      ...(search && { search }),
    })
    fetch(`/api/provincial/orders?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setOrders(data.orders || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.summary)  setSummary(data.summary)
        if (data.supplier) setSupplier(data.supplier)
      })
      .finally(() => setLoading(false))
  }, [tab, statusFilter, typeFilter, page, search])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    setUpdatingId(orderId)
    await fetch('/api/provincial/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, status: newStatus }),
    })
    setUpdatingId(null)
    fetchOrders()
  }

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Orders</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {tab === 'my_orders'
              ? supplier ? `Buying from: ${supplier.level} — ${supplier.full_name}` : 'Your purchase orders'
              : 'Orders from your resellers'}
          </p>
        </div>
        {tab === 'my_orders' && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#C9A84C] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#b8963e] transition-colors font-medium"
          >
            + New Order
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        {([
          { key: 'my_orders',  label: 'My Orders',       desc: 'To supplier' },
          { key: 'city_orders', label: 'City Orders',      desc: 'From city distributors' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key as 'my_orders' | 'city_orders'); setStatusFilter('all'); setTypeFilter('all'); setSearch(''); setSearchInput('') }}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              tab === t.key
                ? 'bg-[#0D1B3E] text-white'
                : 'text-gray-400 hover:text-[#0D1B3E]'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs opacity-60">{t.desc}</span>
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total',      value: summary.total,      accent: 'navy'  },
          { label: 'Pending',    value: summary.pending,    accent: 'gold'  },
          { label: 'Processing', value: summary.processing, accent: 'navy'  },
          { label: 'Delivered',  value: summary.delivered,  accent: 'green' },
          { label: 'Cancelled',  value: summary.cancelled,  accent: 'red'   },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${
              s.accent === 'gold'  ? '#C9A84C' :
              s.accent === 'green' ? '#1a7a4a' :
              s.accent === 'red'   ? '#e05252' : '#0D1B3E'
            }` }}
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color:
              s.accent === 'gold'  ? '#C9A84C' :
              s.accent === 'green' ? '#1a7a4a' :
              s.accent === 'red'   ? '#e05252' : '#0D1B3E'
            }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={tab === 'my_orders' ? 'Search supplier...' : 'Search buyer...'}
            className="flex-1 min-w-[180px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1 flex-wrap">
            {(['all', 'pending', 'processing', 'delivered', 'cancelled'] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  statusFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}>{f}</button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['all', 'online', 'offline'] as const).map((f) => (
              <button key={f} onClick={() => setTypeFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  typeFilter === f ? 'bg-[#C9A84C] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}>{f}</button>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
          {[tab === 'my_orders' ? 'Supplier' : 'Buyer', 'Type', 'Amount', 'Status', 'Actions'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            {tab === 'my_orders' ? 'No purchase orders yet. Click "+ New Order" to place one.' : 'No city distributor orders yet.'}
          </div>
        ) : (
          orders.map((order) => {
            const counterparty = tab === 'my_orders' ? order.seller : order.buyer
            const nextStatuses = tab === 'city_orders' ? STATUS_NEXT[order.status] : (order.status === 'pending' ? ['cancelled'] : [])
            return (
              <div key={order.id}>
                <div
                  className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center cursor-pointer"
                  onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                >
                  {/* Counterparty */}
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">{counterparty.full_name}</p>
                    <p className="text-xs text-gray-400 capitalize">@{counterparty.username} · {counterparty.role}</p>
                  </div>

                  {/* Type */}
                  <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${
                    order.order_type === 'online' ? 'bg-[#f0f7ff] text-[#2563eb]' : 'bg-[#eef0f8] text-[#0D1B3E]'
                  }`}>{order.order_type}</span>

                  {/* Amount */}
                  <div>
                    <p className="text-xs font-semibold text-[#0D1B3E]">₱{Number(order.total_amount).toLocaleString()}</p>
                    <p className="text-xs text-gray-400">{new Date(order.created_at).toLocaleDateString('en-PH')}</p>
                  </div>

                  {/* Status */}
                  <span className={`text-xs px-2 py-0.5 rounded-full w-fit capitalize ${STATUS_COLORS[order.status] || ''}`}>
                    {order.status}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {nextStatuses.map((next) => (
                      <button
                        key={next}
                        disabled={updatingId === order.id}
                        onClick={() => handleStatusUpdate(order.id, next)}
                        className={`text-xs px-2 py-1 rounded-lg capitalize transition-colors disabled:opacity-50 ${
                          next === 'cancelled'
                            ? 'bg-[#fdecea] text-[#a03030] hover:bg-[#fcd9d9]'
                            : 'bg-[#0D1B3E] text-white hover:bg-[#162850]'
                        }`}
                      >
                        {next === 'processing' ? 'Process' : next === 'delivered' ? 'Deliver' : 'Cancel'}
                      </button>
                    ))}
                    <span className="text-gray-300 text-xs ml-1">{expandedId === order.id ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded items */}
                {expandedId === order.id && (
                  <div className="px-6 py-3 bg-[#F8F9FC] border-b border-[#0D1B3E]/5">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Order Items</p>
                    {order.items.length === 0 ? (
                      <p className="text-xs text-gray-400">{order.notes || 'No items'}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {order.items.map((item, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                item.product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'
                              }`}>{item.product.type}</span>
                              <span className="text-[#0D1B3E] font-medium">{item.product.name}</span>
                              <span className="text-gray-400">× {item.quantity}</span>
                            </div>
                            <span className="text-[#0D1B3E] font-medium">₱{Number(item.subtotal).toLocaleString()}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs pt-1.5 border-t border-[#0D1B3E]/8 font-semibold">
                          <span className="text-gray-400">Total</span>
                          <span className="text-[#0D1B3E]">₱{Number(order.total_amount).toLocaleString()}</span>
                        </div>
                      </div>
                    )}
                    {order.notes && <p className="text-xs text-gray-400 mt-2 italic">Note: {order.notes}</p>}
                  </div>
                )}
              </div>
            )
          })
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Create Order Modal */}
      {showCreate && supplier && (
        <CreateOrderModal
          supplier={supplier}
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); fetchOrders() }}
        />
      )}
    </div>
  )
}