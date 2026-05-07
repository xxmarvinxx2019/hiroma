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

const ROLE_LABEL: Record<string, string> = {
  admin:        'Admin',
  regional:     'Regional',
  provincial:   'Provincial',
  city:         'City',
  reseller:     'Reseller',
}

const ROLE_COLOR: Record<string, string> = {
  admin:      'bg-[#fdecea] text-[#a03030]',
  regional:   'bg-[#f0f7ff] text-[#2563eb]',
  provincial: 'bg-[#fef9ee] text-[#9a6f1e]',
  city:       'bg-[#e8f7ef] text-[#1a7a4a]',
  reseller:   'bg-[#eef0f8] text-[#0D1B3E]',
}

// ============================================================
// PAGE
// ============================================================

export default function AdminOrdersPage() {
  const [orders, setOrders]   = useState<Order[]>([])
  const [meta, setMeta]       = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter]     = useState('all')
  const [levelFilter, setLevelFilter]   = useState('all')
  const [searchInput, setSearchInput]   = useState('')
  const [search, setSearch]             = useState('')
  const [page, setPage]                 = useState(1)
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [updatingId, setUpdatingId]     = useState<string | null>(null)

  const [summary, setSummary] = useState({
    total: 0, pending: 0, processing: 0, delivered: 0, cancelled: 0,
  })

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [statusFilter, typeFilter, levelFilter, search])

  const fetchOrders = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      status: statusFilter, type: typeFilter, level: levelFilter,
      page: String(page), pageSize: String(PAGE_SIZE),
      ...(search && { search }),
    })
    fetch(`/api/admin/orders?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setOrders(data.orders || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.summary) setSummary(data.summary)
      })
      .finally(() => setLoading(false))
  }, [statusFilter, typeFilter, levelFilter, page, search])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    setUpdatingId(orderId)
    await fetch('/api/admin/orders', {
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
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Distributor Orders</h1>
        <p className="text-sm text-gray-400 mt-0.5">Orders placed by distributors across all levels</p>
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
            placeholder="Search buyer or seller..."
            className="flex-1 min-w-[180px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />

          {/* Level filter */}
          <div className="flex gap-1">
            {(['all', 'regional', 'provincial', 'city'] as const).map((f) => (
              <button key={f} onClick={() => setLevelFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  levelFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}>{f}</button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex gap-1 flex-wrap">
            {(['all', 'pending', 'processing', 'delivered', 'cancelled'] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  statusFilter === f ? 'bg-[#C9A84C] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}>{f}</button>
            ))}
          </div>

          {/* Type filter */}
          <div className="flex gap-1">
            {(['all', 'online', 'offline'] as const).map((f) => (
              <button key={f} onClick={() => setTypeFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  typeFilter === f ? 'bg-[#eef0f8] text-[#0D1B3E] border border-[#0D1B3E]/20' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}>{f}</button>
            ))}
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-6 px-4 py-2 bg-[#F0F2F8]">
          {['Buyer', 'Selling To', 'Type', 'Amount', 'Status', 'Actions'].map((h) => (
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
          <div className="px-4 py-12 text-center text-gray-400 text-sm">No distributor orders found</div>
        ) : (
          orders.map((order) => (
            <div key={order.id}>
              <div
                className="grid grid-cols-6 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center cursor-pointer"
                onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
              >
                {/* Buyer */}
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{order.buyer.full_name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ROLE_COLOR[order.buyer.role]}`}>
                      {ROLE_LABEL[order.buyer.role]}
                    </span>
                    <span className="text-[10px] text-gray-400">@{order.buyer.username}</span>
                  </div>
                </div>

                {/* Seller */}
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{order.seller.full_name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ROLE_COLOR[order.seller.role]}`}>
                      {ROLE_LABEL[order.seller.role]}
                    </span>
                    <span className="text-[10px] text-gray-400">@{order.seller.username}</span>
                  </div>
                </div>

                {/* Type */}
                <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${
                  order.order_type === 'online' ? 'bg-[#f0f7ff] text-[#2563eb]' : 'bg-[#eef0f8] text-[#0D1B3E]'
                }`}>{order.order_type}</span>

                {/* Amount */}
                <div>
                  <p className="text-xs font-semibold text-[#0D1B3E]">
                    ₱{Number(order.total_amount).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(order.created_at).toLocaleDateString('en-PH')}
                  </p>
                </div>

                {/* Status */}
                <span className={`text-xs px-2 py-0.5 rounded-full w-fit capitalize ${STATUS_COLORS[order.status] || ''}`}>
                  {order.status}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {STATUS_NEXT[order.status]?.map((next) => (
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
                          <span className="text-[#0D1B3E] font-medium">
                            ₱{Number(item.subtotal).toLocaleString()}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between text-xs pt-1.5 border-t border-[#0D1B3E]/8 font-semibold">
                        <span className="text-gray-400">Total</span>
                        <span className="text-[#0D1B3E]">₱{Number(order.total_amount).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                  {order.notes && (
                    <p className="text-xs text-gray-400 mt-2 italic">Note: {order.notes}</p>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>
    </div>
  )
}