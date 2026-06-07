'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface OrderDetail {
  id:                string
  order_number:      string | null
  status:            string
  total_amount:      number
  payment_method:    string
  payment_reference: string | null
  payment_status:    string
  notes:             string | null
  created_at:        string
  buyer: {
    full_name: string
    username:  string
    mobile:    string
    address:   string | null
    role:      string
  } | null
  seller: {
    full_name: string
    username:  string
    mobile:    string
    address:   string | null
    role:      string
  } | null
  items: {
    id:       string
    quantity: number
    unit_price: number
    subtotal:   number
    product: { id: string; name: string; type: string } | null
  }[]
}

const STATUS_STEPS = [
  { key: 'pending',    label: 'Order Placed',  icon: '📋', desc: 'Your order has been received and is awaiting confirmation.' },
  { key: 'processing', label: 'Processing',    icon: '⚙️', desc: 'Your order is being prepared by the seller.' },
  { key: 'packed',     label: 'Packed',        icon: '📦', desc: 'Your order has been packed and is ready for delivery.' },
  { key: 'delivered',  label: 'Delivered',     icon: '✅', desc: 'Your order has been delivered successfully.' },
]

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash:         'Cash',
  gcash:        'GCash',
  bank_transfer: 'Bank Transfer',
  walk_in:      'Walk-in',
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
}

export default function OrderDetailPage() {
  const params  = useParams()
  const router  = useRouter()
  const id      = params?.id as string

  const [order, setOrder]   = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetch(`/api/orders/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error)
        else setOrder(data.order)
      })
      .catch(() => setError('Failed to load order.'))
      .finally(() => setLoading(false))
  }, [id])

  const currentStepIndex = order
    ? order.status === 'cancelled'
      ? -1
      : STATUS_STEPS.findIndex((s) => s.key === order.status)
    : 0

  if (loading) return (
    <div className="max-w-5xl mx-auto py-12 text-center">
      <div className="w-8 h-8 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
      <p className="text-gray-400 text-sm">Loading order details...</p>
    </div>
  )

  if (error || !order) return (
    <div className="max-w-5xl mx-auto py-12 text-center">
      <p className="text-4xl mb-4">📋</p>
      <p className="text-[#0D1B3E] font-semibold mb-1">Order not found</p>
      <p className="text-gray-400 text-sm mb-4">{error || 'This order does not exist or you do not have access.'}</p>
      <button onClick={() => router.push('/dashboard/reseller/orders')} className="text-xs text-[#C9A84C] hover:underline">← Go back</button>
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <button onClick={() => router.push('/dashboard/reseller/orders')}
          className="text-xs text-gray-400 hover:text-[#0D1B3E] transition-colors mb-3 flex items-center gap-1">
          ← Back to Orders
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#0D1B3E]">
              Order {order.order_number || `#${order.id.slice(0, 8).toUpperCase()}`}
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Placed on {new Date(order.created_at).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
            order.status === 'delivered'  ? 'bg-[#e8f7ef] text-[#1a7a4a]' :
            order.status === 'cancelled'  ? 'bg-[#fdecea] text-[#a03030]' :
            order.status === 'processing' ? 'bg-[#eef0f8] text-[#0D1B3E]' :
            'bg-[#fef9ee] text-[#9a6f1e]'
          }`}>
            {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — Order details */}
        <div className="lg:col-span-2 space-y-5">

          {/* Order Items */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <h2 className="text-sm font-semibold text-[#0D1B3E]">Order Items</h2>
            </div>
            <div className="divide-y divide-[#0D1B3E]/5">
              {order.items.map((item) => (
                <div key={item.id} className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#F0F2F8] rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-lg">{item.product?.type === 'physical' ? '📦' : '💻'}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#0D1B3E]">{item.product?.name || '—'}</p>
                      <p className="text-xs text-gray-400">{fmt(item.unit_price)} × {item.quantity}</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-[#0D1B3E]">{fmt(item.subtotal)}</p>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 bg-[#F0F2F8] space-y-2">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Subtotal</span>
                <span>{fmt(order.total_amount)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-[#0D1B3E] pt-2 border-t border-[#0D1B3E]/10">
                <span>Total Amount</span>
                <span className="text-[#C9A84C]">{fmt(order.total_amount)}</span>
              </div>
            </div>
          </div>

          {/* Payment Info */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <h2 className="text-sm font-semibold text-[#0D1B3E]">Payment Information</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Payment Method</span>
                <span className="font-medium text-[#0D1B3E]">{PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method}</span>
              </div>
              {order.payment_reference && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Reference No.</span>
                  <span className="font-medium text-[#0D1B3E] font-mono">{order.payment_reference}</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Payment Status</span>
                <span className={`font-semibold ${order.payment_status === 'paid' ? 'text-[#1a7a4a]' : 'text-[#9a6f1e]'}`}>
                  {order.payment_status === 'paid' ? '✓ Paid' : order.payment_status.charAt(0).toUpperCase() + order.payment_status.slice(1)}
                </span>
              </div>
              <div className="flex justify-between text-xs pt-2 border-t border-[#0D1B3E]/8">
                <span className="text-gray-400">Total Amount</span>
                <span className="font-bold text-[#0D1B3E]">{fmt(order.total_amount)}</span>
              </div>
            </div>
          </div>

          {/* Buyer & Seller */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Buyer', data: order.buyer },
              { label: 'Seller', data: order.seller },
            ].map(({ label, data }) => (
              <div key={label} className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{label}</h3>
                {data ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-[#0D1B3E]">{data.full_name}</p>
                    <p className="text-xs text-gray-400">@{data.username}</p>
                    <p className="text-xs text-gray-400">{data.mobile}</p>
                    {data.address && <p className="text-xs text-gray-400">{data.address}</p>}
                  </div>
                ) : <p className="text-xs text-gray-400">—</p>}
              </div>
            ))}
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes</h3>
              <p className="text-sm text-gray-500">{order.notes}</p>
            </div>
          )}
        </div>

        {/* Right — Status Timeline */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <h2 className="text-sm font-semibold text-[#0D1B3E]">Order Status</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Last updated {new Date(order.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {order.status === 'cancelled' ? (
              <div className="px-5 py-6 text-center">
                <span className="text-4xl">❌</span>
                <p className="text-sm font-semibold text-[#a03030] mt-2">Order Cancelled</p>
                <p className="text-xs text-gray-400 mt-1">This order has been cancelled.</p>
              </div>
            ) : (
              <div className="px-5 py-4">
                <div className="relative">
                  {/* Progress line */}
                  <div className="absolute left-5 top-6 bottom-6 w-0.5 bg-[#F0F2F8]" />
                  <div
                    className="absolute left-5 top-6 w-0.5 bg-[#C9A84C] transition-all duration-500"
                    style={{ height: `${Math.max(0, (currentStepIndex / (STATUS_STEPS.length - 1)) * 100)}%` }}
                  />

                  <div className="space-y-6 relative">
                    {STATUS_STEPS.map((step, i) => {
                      const done    = i < currentStepIndex
                      const current = i === currentStepIndex
                      const pending = i > currentStepIndex
                      return (
                        <div key={step.key} className="flex items-start gap-4">
                          {/* Circle */}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-10 border-2 transition-all ${
                            done    ? 'bg-[#1a7a4a] border-[#1a7a4a]' :
                            current ? 'bg-[#C9A84C] border-[#C9A84C]' :
                            'bg-white border-[#0D1B3E]/15'
                          }`}>
                            {done ? (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M3 8L6.5 11.5L13 4.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            ) : (
                              <span className={`text-base ${pending ? 'opacity-30' : ''}`}>{step.icon}</span>
                            )}
                          </div>
                          {/* Content */}
                          <div className="pt-1.5 flex-1">
                            <p className={`text-sm font-semibold ${
                              done ? 'text-[#1a7a4a]' : current ? 'text-[#0D1B3E]' : 'text-gray-300'
                            }`}>
                              {step.label}
                              {current && <span className="ml-2 text-[10px] text-[#C9A84C] font-normal uppercase tracking-wide">Current</span>}
                            </p>
                            {(done || current) && (
                              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{step.desc}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Order Summary Card */}
          <div className="bg-[#0D1B3E] rounded-2xl p-5">
            <p className="text-[#C9A84C] text-[10px] tracking-widest uppercase mb-3">Order Summary</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Order No.</span>
                <span className="text-white font-mono font-semibold">{order.order_number || order.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Items</span>
                <span className="text-white">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Total</span>
                <span className="text-[#C9A84C] font-bold">{fmt(order.total_amount)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/50">Payment</span>
                <span className={order.payment_status === 'paid' ? 'text-[#1a7a4a]' : 'text-[#9a6f1e]'}>
                  {order.payment_status === 'paid' ? '✓ Paid' : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}