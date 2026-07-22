'use client'

import Link from 'next/link'
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
  order_number: string | null
  order_type: string
  status: string
  total_amount: number
  created_at: string
  notes: string | null
  payment_method:      string | null
  payment_reference:   string | null
  payment_sender_name: string | null
  payment_datetime:    string | null
  payment_status:      string | null
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

// Orders must be paid before moving to processing
function canProcess(order: Order) {
  return order.payment_status === 'paid'
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
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null)

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
            placeholder="Search buyer, seller or ref no..."
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
                  {order.payment_method && order.payment_method !== 'cash_on_pickup' && (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-[10px] text-gray-400">{order.payment_method === 'gcash' ? '📱 GCash' : order.payment_method === 'bank_transfer' ? '🏦 Bank Transfer' : '💵 Cash'}</p>
                      {order.payment_reference    && <p className="text-[10px] text-gray-400">Ref: {order.payment_reference}</p>}
                      {order.payment_sender_name  && <p className="text-[10px] text-gray-400">Sender: {order.payment_sender_name}</p>}
                      {order.payment_datetime     && <p className="text-[10px] text-gray-400">{new Date(order.payment_datetime).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
                      {order.payment_status === 'paid'
                        ? <span className="text-[10px] text-[#1a7a4a] font-medium">✓ Paid</span>
                        : <span className="text-[10px] text-[#9a6f1e]">⏳ Unpaid</span>}
                    </div>
                  )}
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
                <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  <Link href={"/dashboard/admin/orders/" + (order.order_number || order.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-7 h-7 rounded-lg bg-[#eef0f8] hover:bg-[#C9A84C] flex items-center justify-center transition-colors group flex-shrink-0"
                    title="View details">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </Link>
                    {order.payment_status !== 'paid' && order.status !== 'cancelled' && (
                      <button
                        onClick={async () => {
                          await fetch('/api/admin/orders', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ order_id: order.id, payment_status: 'paid' }),
                          })
                          fetchOrders()
                        }}
                        className="w-7 h-7 rounded-lg bg-[#e8f7ef] hover:bg-[#1a7a4a] flex items-center justify-center transition-colors group flex-shrink-0"
                      title="Mark as paid">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1a7a4a] group-hover:text-white">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                      </svg>
                    </button>
                    )}
                  {STATUS_NEXT[order.status]?.map((next) => (
                    <button key={next}
                      disabled={updatingId === order.id || (next === 'processing' && !canProcess(order))}
                      onClick={() => next === 'cancelled' ? setCancelConfirm(order.id) : handleStatusUpdate(order.id, next)}
                      className={"w-7 h-7 rounded-lg flex items-center justify-center transition-colors group flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed " + (
                        next === 'cancelled' ? 'bg-[#fdecea] hover:bg-[#a03030]' :
                        next === 'delivered' ? 'bg-[#e8f7ef] hover:bg-[#1a7a4a]' :
                        next === 'processing' && !canProcess(order) ? 'bg-[#f1f5f9] cursor-not-allowed' :
                        'bg-[#eef0f8] hover:bg-[#0D1B3E]'
                      )}
                      title={
                        next === 'processing' && !canProcess(order) ? 'Mark as paid first before processing' :
                        next === 'processing' ? 'Mark Processing' :
                        next === 'delivered'  ? 'Mark Delivered' :
                        'Cancel'
                      }>
                      {next === 'cancelled' ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={"group-hover:text-white " + "text-[#a03030]"}>
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      ) : next === 'delivered' ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1a7a4a] group-hover:text-white">
                          <path d="M5 13l4 4L19 7"/>
                        </svg>
                      ) : next === 'packed' ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                        </svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                        </svg>
                      )}
                    </button>
                  ))}
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
      {/* Cancel Confirmation Modal */}
      {cancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#0D1B3E]/8 p-6 w-80 mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#fdecea] flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e05252" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-[#0D1B3E]">Cancel Order?</p>
                <p className="text-xs text-gray-400 mt-0.5">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-5">
              Are you sure you want to cancel this order? The order status will be permanently set to cancelled.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setCancelConfirm(null)}
                className="flex-1 py-2 rounded-xl border border-[#0D1B3E]/15 text-xs font-medium text-gray-500 hover:bg-[#f8f9fc] transition-colors">
                Keep Order
              </button>
              <button onClick={() => { handleStatusUpdate(cancelConfirm, 'cancelled'); setCancelConfirm(null) }}
                className="flex-1 py-2 rounded-xl bg-[#e05252] text-white text-xs font-bold hover:bg-[#c03030] transition-colors">
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}