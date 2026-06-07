'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

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
  payment_status:      string | null
  buyer:  { full_name: string; username: string; role: string }
  seller: { full_name: string; username: string; role: string }
  items: OrderItem[]
}

interface Reseller {
  id: string
  full_name: string
  username: string
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
  available_quantity: number
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

const PAYMENT_LABEL: Record<string, string> = {
  cash_on_pickup: '💵 Cash on Pickup',
  gcash:          '📱 GCash',
  bank_transfer:  '🏦 Bank Transfer',
}

// ── City dist orders from supplier ──
function CreateOrderModal({ supplier, onClose, onSuccess }: {
  supplier: Supplier; onClose: () => void; onSuccess: () => void
}) {
  const [products, setProducts]     = useState<Product[]>([])
  const [cart, setCart]             = useState<CartItem[]>([])
  const [orderType, setOrderType]   = useState<'online' | 'offline'>('online')
  const [notes, setNotes]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [search, setSearch]           = useState('')
  const [paymentMethod, setPaymentMethod]     = useState('cash')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentMethods, setPaymentMethods]   = useState<{ id: string; type: string; account_name: string; account_number: string; bank_name: string | null }[]>([])

  // Fetch supplier's payment methods so city dist knows how to pay them
  useEffect(() => {
    if (!supplier?.id) return
    fetch(`/api/payment-methods?user_id=${supplier.id}&status=approved`)
      .then((r) => r.json())
      .then((d) => setPaymentMethods(d.methods || []))
      .catch(() => {})
  }, [supplier?.id])

  useEffect(() => {
    fetch('/api/city/products?for_ordering=true').then((r) => r.json()).then((d) => setProducts(d.products || []))
  }, [])

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))

  const addToCart = (product: Product) => {
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

  const total = cart.reduce((s, c) => s + c.product.price * c.quantity, 0)

  const handleSubmit = async () => {
    if (cart.length === 0) { setError('Add at least one item.'); return }
    setSubmitting(true); setError('')
    const res = await fetch('/api/city/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_type: orderType, notes, payment_method: paymentMethod, payment_reference: paymentReference.trim() || null, items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity, unit_price: c.product.price })) }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) onSuccess()
    else setError(data.error || 'Something went wrong.')
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Place New Order</h2>
            <p className="text-xs text-gray-400 mt-0.5">Ordering from: <span className="text-[#C9A84C] font-medium">{supplier.level} — {supplier.full_name}</span></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col border-r border-[#0D1B3E]/8 min-w-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..."
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No products found</p> : (
                filtered.map((product) => (
                  <div key={product.id} className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors">
                    <div>
                      <p className="text-xs font-medium text-[#0D1B3E]">{product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>{product.type}</span>
                        <span className="text-xs text-gray-400">₱{Number(product.price).toLocaleString()}</span>
                        <span className="text-xs text-gray-300">· {product.available_quantity} in stock</span>
                      </div>
                    </div>
                    <button onClick={() => addToCart(product)} disabled={product.available_quantity === 0}
                      className="text-xs bg-[#0D1B3E] text-white px-3 py-1.5 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      {product.available_quantity === 0 ? 'No stock' : '+ Add'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="w-56 flex flex-col flex-shrink-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <p className="text-xs font-semibold text-[#0D1B3E]">Order Summary</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
              {cart.length === 0 ? <p className="text-xs text-gray-400 text-center pt-4">No items yet</p> : (
                cart.map((c) => (
                  <div key={c.product.id} className="text-xs">
                    <p className="font-medium text-[#0D1B3E] truncate">{c.product.name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <button onClick={() => updateQty(c.product.id, c.quantity - 1)}
                        className="w-5 h-5 bg-[#F0F2F8] rounded text-[#0D1B3E] font-bold text-xs flex items-center justify-center flex-shrink-0">−</button>
                      <input type="number" min={1} max={c.product.available_quantity} value={c.quantity}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) updateQty(c.product.id, Math.min(v, c.product.available_quantity || 9999)) }}
                        className="w-10 text-center text-xs text-[#0D1B3E] bg-[#F0F2F8] rounded border border-[#0D1B3E]/15 outline-none focus:border-[#C9A84C] py-0.5" />
                      <button onClick={() => updateQty(c.product.id, c.quantity + 1)}
                        disabled={!!c.product.available_quantity && c.quantity >= c.product.available_quantity}
                        className="w-5 h-5 bg-[#F0F2F8] rounded text-[#0D1B3E] font-bold text-xs flex items-center justify-center flex-shrink-0 disabled:opacity-30">+</button>
                      <span className="ml-auto text-gray-400">₱{(c.product.price * c.quantity).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-[#0D1B3E]/8 flex-shrink-0 space-y-3">
              <div className="flex justify-between text-xs font-semibold text-[#0D1B3E]"><span>Total</span><span>₱{total.toLocaleString()}</span></div>
              <div className="flex gap-1">
                {(['online', 'offline'] as const).map((t) => (
                  <button key={t} onClick={() => setOrderType(t)}
                    className={`flex-1 text-xs py-1.5 rounded-lg capitalize transition-colors ${orderType === t ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400'}`}>{t}</button>
                ))}
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400 resize-none" />
              {/* Payment Method */}
              <div>
                <p className="text-xs font-medium text-[#0D1B3E] mb-1.5">Payment Method</p>
                <div className="space-y-1">
                  <div onClick={() => setPaymentMethod('cash')}
                    className={"flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors " + (paymentMethod === 'cash' ? 'border-[#C9A84C] bg-[#fef9ee]' : 'border-[#0D1B3E]/10 hover:border-[#C9A84C]/40')}>
                    <span className="text-sm">💵</span>
                    <span className="text-xs text-[#0D1B3E]">Cash on Pickup</span>
                    {paymentMethod === 'cash' && <span className="ml-auto text-[#C9A84C] text-xs">✓</span>}
                  </div>
                  {paymentMethods.map((pm) => (
                    <div key={pm.id} onClick={() => setPaymentMethod(pm.type)}
                      className={"flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors " + (paymentMethod === pm.type ? 'border-[#C9A84C] bg-[#fef9ee]' : 'border-[#0D1B3E]/10 hover:border-[#C9A84C]/40')}>
                      <span className="text-sm">{pm.type === 'gcash' ? '📱' : '🏦'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#0D1B3E] capitalize">{pm.type === 'bank_transfer' ? 'Bank Transfer' : pm.type}</p>
                        <p className="text-[10px] text-gray-400">{pm.account_name} · {pm.account_number}</p>
                      </div>
                      {paymentMethod === pm.type && <span className="ml-auto text-[#C9A84C] text-xs">✓</span>}
                    </div>
                  ))}
                </div>
                {paymentMethod !== 'cash' && (
                  <input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Reference / transaction number" className="mt-1.5 w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[#C9A84C]" />
                )}
              </div>

              {error && <p className="text-xs text-[#a03030]">{error}</p>}
              <button onClick={handleSubmit} disabled={submitting || cart.length === 0}
                className="w-full bg-[#C9A84C] text-white text-xs py-2 rounded-lg hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium">
                {submitting ? 'Placing...' : 'Place Order'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── City dist creates walk-in order for reseller ──
function CreateResellerOrderModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [resellers, setResellers]           = useState<Reseller[]>([])
  const [selectedResellerId, setResellerId] = useState('')
  const [resellerSearch, setResellerSearch] = useState('')
  const [showResellerDrop, setShowResellerDrop] = useState(false)
  const [products, setProducts]             = useState<{ id: string; name: string; type: string; price: number; available_quantity: number }[]>([])
  const [cart, setCart]                     = useState<{ product: { id: string; name: string; type: string; price: number; available_quantity: number }; quantity: number }[]>([])
  const [orderType, setOrderType]           = useState<'online' | 'offline'>('offline')
  const [notes, setNotes]                   = useState('')
  const [search, setSearch]                 = useState('')
  const [submitting, setSubmitting]         = useState(false)
  const [error, setError]                   = useState('')
  const [loadingProducts, setLoadingProducts] = useState(false)

  useEffect(() => {
    fetch('/api/city/orders/reseller-orders').then((r) => r.json()).then((d) => setResellers(d.resellers || []))
  }, [])

  useEffect(() => {
    if (!selectedResellerId) { setProducts([]); return }
    setLoadingProducts(true)
    fetch('/api/city/products?for_reseller=true').then((r) => r.json()).then((d) => setProducts(d.products || [])).finally(() => setLoadingProducts(false))
    setCart([])
  }, [selectedResellerId])

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) setCart((prev) => prev.filter((c) => c.product.id !== productId))
    else setCart((prev) => prev.map((c) => {
      if (c.product.id !== productId) return c
      return { ...c, quantity: Math.min(qty, c.product.available_quantity || 9999) }
    }))
  }

  const addToCart = (product: typeof products[0]) => {
    setCart((prev) => {
      const ex = prev.find((c) => c.product.id === product.id)
      if (ex) return prev.map((c) => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { product, quantity: 1 }]
    })
  }

  const total = cart.reduce((s, c) => s + c.product.price * c.quantity, 0)

  const handleSubmit = async () => {
    if (!selectedResellerId) { setError('Please select a reseller.'); return }
    if (cart.length === 0)   { setError('Add at least one item.'); return }
    setSubmitting(true); setError('')
    const res = await fetch('/api/city/orders/reseller-orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reseller_id: selectedResellerId, order_type: orderType, notes, items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })) }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) onSuccess()
    else setError(data.error || 'Something went wrong.')
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Create Order for Reseller</h2>
            <p className="text-xs text-gray-400 mt-0.5">Walk-in / in-person order — marked as delivered immediately</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col border-r border-[#0D1B3E]/8 min-w-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0 space-y-2">
              <div className="relative">
                <label className="block text-xs text-gray-400 mb-1">Select Reseller</label>
                <div className="relative">
                  <input
                    type="text"
                    value={resellerSearch || (selectedResellerId ? (resellers.find((r) => r.id === selectedResellerId)?.full_name || '') : '')}
                    onChange={(e) => {
                      setResellerSearch(e.target.value)
                      setShowResellerDrop(true)
                      if (!e.target.value) setResellerId('')
                    }}
                    onFocus={() => setShowResellerDrop(true)}
                    onBlur={() => setTimeout(() => setShowResellerDrop(false), 150)}
                    placeholder="Search reseller..."
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400"
                  />
                  {selectedResellerId && (
                    <button onClick={() => { setResellerId(''); setResellerSearch('') }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#0D1B3E] text-xs">✕</button>
                  )}
                </div>
                {showResellerDrop && (
                  <div className="absolute z-[100] w-full bg-white border border-[#0D1B3E]/15 rounded-xl shadow-xl mt-1 max-h-40 overflow-y-auto">
                    {resellers
                      .filter((r) =>
                        !resellerSearch ||
                        r.full_name.toLowerCase().includes(resellerSearch.toLowerCase()) ||
                        r.username.toLowerCase().includes(resellerSearch.toLowerCase())
                      )
                      .map((r) => (
                        <div key={r.id}
                          onMouseDown={() => {
                            setResellerId(r.id)
                            setResellerSearch('')
                            setShowResellerDrop(false)
                          }}
                          className={`px-3 py-2.5 cursor-pointer hover:bg-[#F0F2F8] transition-colors ${selectedResellerId === r.id ? 'bg-[#F0F2F8]' : ''}`}>
                          <p className="text-xs font-medium text-[#0D1B3E]">{r.full_name}</p>
                          <p className="text-[10px] text-gray-400">@{r.username}</p>
                        </div>
                      ))
                    }
                    {resellers.filter((r) =>
                      !resellerSearch ||
                      r.full_name.toLowerCase().includes(resellerSearch.toLowerCase()) ||
                      r.username.toLowerCase().includes(resellerSearch.toLowerCase())
                    ).length === 0 && (
                      <p className="text-xs text-gray-400 px-3 py-3 text-center">No reseller found</p>
                    )}
                  </div>
                )}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..."
                disabled={!selectedResellerId}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400 disabled:opacity-50" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {!selectedResellerId ? <p className="text-center text-xs text-gray-400 py-8">Select a reseller first</p>
                : loadingProducts ? <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" /></div>
                : filtered.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No products in stock</p>
                : filtered.map((product) => (
                  <div key={product.id} className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors">
                    <div>
                      <p className="text-xs font-medium text-[#0D1B3E]">{product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>{product.type}</span>
                        <span className="text-xs text-gray-400">₱{Number(product.price).toLocaleString()}</span>
                        <span className="text-xs text-gray-300">· {product.available_quantity} in stock</span>
                      </div>
                    </div>
                    <button onClick={() => addToCart(product)} className="text-xs bg-[#0D1B3E] text-white px-3 py-1.5 rounded-lg hover:bg-[#162850] transition-colors">+ Add</button>
                  </div>
                ))}
            </div>
          </div>
          <div className="w-56 flex flex-col flex-shrink-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <p className="text-xs font-semibold text-[#0D1B3E]">Order Summary</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
              {cart.length === 0 ? <p className="text-xs text-gray-400 text-center pt-4">No items yet</p> : (
                cart.map((c) => (
                  <div key={c.product.id} className="text-xs">
                    <p className="font-medium text-[#0D1B3E] truncate">{c.product.name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <button onClick={() => updateQty(c.product.id, c.quantity - 1)}
                        className="w-5 h-5 bg-[#F0F2F8] rounded text-[#0D1B3E] font-bold flex items-center justify-center flex-shrink-0">−</button>
                      <input type="number" min={1} max={c.product.available_quantity} value={c.quantity}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) updateQty(c.product.id, Math.min(v, c.product.available_quantity || 9999)) }}
                        className="w-10 text-center text-xs text-[#0D1B3E] bg-[#F0F2F8] rounded border border-[#0D1B3E]/15 outline-none focus:border-[#C9A84C] py-0.5" />
                      <button onClick={() => updateQty(c.product.id, c.quantity + 1)}
                        disabled={!!c.product.available_quantity && c.quantity >= c.product.available_quantity}
                        className="w-5 h-5 bg-[#F0F2F8] rounded text-[#0D1B3E] font-bold flex items-center justify-center flex-shrink-0 disabled:opacity-30">+</button>
                      <span className="ml-auto text-gray-400">₱{(c.product.price * c.quantity).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-[#0D1B3E]/8 flex-shrink-0 space-y-3">
              <div className="flex justify-between text-xs font-semibold text-[#0D1B3E]"><span>Total</span><span>₱{total.toLocaleString()}</span></div>
              <div className="flex gap-1">
                {(['online', 'offline'] as const).map((t) => (
                  <button key={t} onClick={() => setOrderType(t)}
                    className={`flex-1 text-xs py-1.5 rounded-lg capitalize transition-colors ${orderType === t ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400'}`}>{t}</button>
                ))}
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs text-[#0D1B3E] outline-none focus:border-[#C9A84C] resize-none placeholder:text-gray-400" />
              {error && <p className="text-xs text-[#a03030]">{error}</p>}
              <button onClick={handleSubmit} disabled={submitting || cart.length === 0 || !selectedResellerId}
                className="w-full bg-[#C9A84C] text-white text-xs py-2 rounded-lg hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium">
                {submitting ? 'Creating...' : 'Create & Deliver'}
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

export default function CityOrdersPage() {
  const [tab, setTab]                       = useState<'my_orders' | 'reseller_orders'>('my_orders')
  const [orders, setOrders]                 = useState<Order[]>([])
  const [meta, setMeta]                     = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]               = useState(true)
  const [statusFilter, setStatusFilter]     = useState('all')
  const [typeFilter, setTypeFilter]         = useState('all')
  const [searchInput, setSearchInput]       = useState('')
  const [search, setSearch]                 = useState('')
  const [page, setPage]                     = useState(1)
  const [expandedId, setExpandedId]         = useState<string | null>(null)
  const [updatingId, setUpdatingId]         = useState<string | null>(null)
  const [supplier, setSupplier]             = useState<Supplier | null>(null)
  const [showCreate, setShowCreate]         = useState(false)
  const [showResellerOrder, setShowResellerOrder] = useState(false)
  const [summary, setSummary]               = useState({ total: 0, pending: 0, processing: 0, delivered: 0, cancelled: 0 })

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
    fetch(`/api/city/orders?${params}`)
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

  // Fetch supplier on mount regardless of tab
  useEffect(() => {
    fetch('/api/city/orders?tab=my_orders&page=1&pageSize=1')
      .then((r) => r.json())
      .then((data) => { if (data.supplier) setSupplier(data.supplier) })
      .catch(() => {})
  }, [])

  const handleStatusUpdate = async (orderId: string, newStatus: string) => {
    setUpdatingId(orderId)
    const res = await fetch('/api/city/orders', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, status: newStatus }),
    })
    const data = await res.json()
    setUpdatingId(null)
    if (!res.ok) alert(data.error || 'Failed to update order.')
    fetchOrders()
  }

  const handleConfirmPayment = async (orderId: string) => {
    await fetch('/api/city/orders', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, payment_status: 'paid' }),
    })
    fetchOrders()
  }

  return (
    <div className="max-w-7xl mx-auto">
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
          <button onClick={() => {
            if (!supplier) { alert('No supplier found. Please contact admin to set up your distribution chain.'); return }
            setShowCreate(true)
          }}
            className="bg-[#C9A84C] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#b8963e] transition-colors font-medium">
            + New Order
          </button>
        )}
        {tab === 'reseller_orders' && (
          <button onClick={() => setShowResellerOrder(true)}
            className="bg-[#0D1B3E] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#162850] transition-colors font-medium">
            + Walk-in Order
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        {([
          { key: 'my_orders',       label: 'My Orders',       desc: 'To supplier' },
          { key: 'reseller_orders', label: 'Reseller Orders', desc: 'From resellers' },
        ] as const).map((t) => (
          <button key={t.key}
            onClick={() => { setTab(t.key); setStatusFilter('all'); setTypeFilter('all'); setSearch(''); setSearchInput('') }}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === t.key ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}<span className="ml-1.5 text-xs opacity-60">{t.desc}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total',      value: summary.total,      accent: '#0D1B3E' },
          { label: 'Pending',    value: summary.pending,    accent: '#C9A84C' },
          { label: 'Processing', value: summary.processing, accent: '#0D1B3E' },
          { label: 'Delivered',  value: summary.delivered,  accent: '#1a7a4a' },
          { label: 'Cancelled',  value: summary.cancelled,  accent: '#e05252' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.accent}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder={tab === 'my_orders' ? 'Search supplier...' : 'Search buyer...'}
            className="flex-1 min-w-[180px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />
          <div className="flex gap-1 flex-wrap">
            {(['all', 'pending', 'processing', 'delivered', 'cancelled'] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${statusFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'}`}>{f}</button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['all', 'online', 'offline'] as const).map((f) => (
              <button key={f} onClick={() => setTypeFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${typeFilter === f ? 'bg-[#C9A84C] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'}`}>{f}</button>
            ))}
          </div>
        </div>

        {/* Table header — 6 cols for reseller orders (includes payment), 5 for my orders */}
        <div className={`grid px-4 py-2 bg-[#F0F2F8]`}
          style={{ gridTemplateColumns: tab === 'reseller_orders' ? '2fr 1fr 1fr 1fr 1fr 1.5fr' : '2fr 1fr 1fr 1fr 1fr' }}>
          {(tab === 'reseller_orders'
            ? ['Buyer', 'Payment', 'Type', 'Amount', 'Status', 'Actions']
            : ['Supplier', 'Type', 'Amount', 'Status', 'Actions']
          ).map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            {tab === 'my_orders' ? 'No purchase orders yet. Click "+ New Order" to place one.' : 'No reseller orders yet.'}
          </div>
        ) : (
          orders.map((order) => {
            const counterparty = tab === 'my_orders' ? order.seller : order.buyer
            const nextStatuses = tab === 'reseller_orders' ? STATUS_NEXT[order.status] : (order.status === 'pending' ? ['cancelled'] : [])
            return (
              <div key={order.id}>
                <div
                  className="grid px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center cursor-pointer"
                  style={{ gridTemplateColumns: tab === 'reseller_orders' ? '2fr 1fr 1fr 1fr 1fr 1.5fr' : '2fr 1fr 1fr 1fr 1fr' }}
                  onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                >
                  {/* Counterparty */}
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">{counterparty.full_name}</p>
                    <p className="text-xs text-gray-400 capitalize">@{counterparty.username} · {counterparty.role}</p>
                  </div>

                  {/* Payment info — only for reseller orders */}
                  {tab === 'reseller_orders' && (
                    <div>
                      <p className="text-[10px] text-gray-500">{PAYMENT_LABEL[order.payment_method || 'cash_on_pickup'] || order.payment_method}</p>
                      {order.payment_reference && (
                        <p className="text-[10px] text-gray-400 truncate">Ref: {order.payment_reference}</p>
                      )}

                      {order.payment_status === 'paid' ? (
                        <span className="text-[10px] text-[#1a7a4a] font-medium">✓ Paid</span>
                      ) : order.payment_method !== 'cash_on_pickup' ? (
                        <span className="text-[10px] text-[#9a6f1e]">⏳ Unpaid</span>
                      ) : null}
                    </div>
                  )}

                  {/* Type */}
                  <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${order.order_type === 'online' ? 'bg-[#f0f7ff] text-[#2563eb]' : 'bg-[#eef0f8] text-[#0D1B3E]'}`}>{order.order_type}</span>

                  {/* Amount */}
                  <div>
                    <p className="text-xs font-semibold text-[#0D1B3E]">₱{Number(order.total_amount).toLocaleString()}</p>
                    <p className="text-xs text-gray-400">{new Date(order.created_at).toLocaleDateString('en-PH')}</p>
                  </div>

                  {/* Status */}
                  <span className={`text-xs px-2 py-0.5 rounded-full w-fit capitalize ${STATUS_COLORS[order.status] || ''}`}>{order.status}</span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                    <Link href={"/dashboard/city/orders/" + (order.order_number || order.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-7 h-7 rounded-lg bg-[#eef0f8] hover:bg-[#C9A84C] flex items-center justify-center transition-colors group flex-shrink-0"
                    title="View details">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </Link>
                    {/* Confirm payment button */}
                    {tab === 'reseller_orders' && order.payment_status !== 'paid' && order.status !== 'cancelled' && (
                      <button
                        onClick={() => handleConfirmPayment(order.id)}
                        disabled={updatingId === order.id}
                        className="w-7 h-7 rounded-lg bg-[#e8f7ef] hover:bg-[#1a7a4a] flex items-center justify-center transition-colors group flex-shrink-0 disabled:opacity-50"
                        title="Mark as paid">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1a7a4a] group-hover:text-white">
                          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                      </button>
                    )}
                    {nextStatuses.map((next) => (
                      <button key={next} disabled={updatingId === order.id} onClick={() => handleStatusUpdate(order.id, next)}
                        className={"w-7 h-7 rounded-lg flex items-center justify-center transition-colors group flex-shrink-0 disabled:opacity-50 " + (next === 'cancelled' ? 'bg-[#fdecea] hover:bg-[#a03030]' : next === 'delivered' ? 'bg-[#e8f7ef] hover:bg-[#1a7a4a]' : 'bg-[#eef0f8] hover:bg-[#0D1B3E]')}
                        title={next === 'processing' ? 'Mark Processing' : next === 'delivered' ? 'Mark Delivered' : 'Cancel'}>
                        {next === 'cancelled' ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#a03030] group-hover:text-white"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        ) : next === 'delivered' ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1a7a4a] group-hover:text-white"><path d="M5 13l4 4L19 7"/></svg>
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                        )}
                      </button>
                    ))}
                    </div>
                </div>

              {expandedId === order.id && (
                  <div className="px-6 py-3 bg-[#F8F9FC] border-b border-[#0D1B3E]/5">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Order Items</p>
                    {order.items.length === 0 ? <p className="text-xs text-gray-400">{order.notes || 'No items'}</p> : (
                      <div className="space-y-1.5">
                        {order.items.map((item, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${item.product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>{item.product.type}</span>
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

      {showResellerOrder && (
        <CreateResellerOrderModal
          onClose={() => setShowResellerOrder(false)}
          onSuccess={() => { setShowResellerOrder(false); fetchOrders() }}
        />
      )}

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