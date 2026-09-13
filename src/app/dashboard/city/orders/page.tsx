'use client'

import CityOrderDetailsModal from './CityOrderDetailsModal'
import { useState, useEffect, useCallback, useId, useRef } from 'react'
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
  is_non_member_sale: boolean
  customer_name: string | null
  notes: string | null
  payment_method:      string | null
  payment_reference:   string | null
  payment_status:      string | null
  fulfillment_method: string
  pickup_scheduled_at: string | null
  pickup_schedule_timezone: string | null
  cancelled_at: string | null
  cancelled_by_actor_id: string | null
  cancelled_by_name: string | null
  cancelled_by_role: string | null
  cancellation_reason: string | null
  buyer:  { full_name: string; username: string; role: string }
  seller: { full_name: string; username: string; role: string }
  items: OrderItem[]
}

interface Reseller {
  id: string
  full_name: string
  username: string
  member_id?: string | null
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
  ready_for_pickup: 'bg-[#f0f7ff] text-[#2563eb]',
  delivered:  'bg-[#e8f7ef] text-[#1a7a4a]',
  cancelled:  'bg-[#fdecea] text-[#a03030]',
}

const STATUS_NEXT: Record<string, string[]> = {
  pending:    ['processing', 'cancelled'],
  processing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['delivered', 'cancelled'],
  delivered:  [],
  cancelled:  [],
}

// Orders must be paid before moving to processing
function canProcess(order: Pick<Order, 'payment_method' | 'payment_status'>) {
  return order.payment_method === 'cash_on_pickup' || order.payment_status === 'paid'
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
                      className="text-xs bg-[#010521] text-white px-3 py-1.5 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
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
              <div className="flex justify-between text-base font-bold text-[#0D1B3E]"><span>Total</span><span>₱{total.toLocaleString()}</span></div>
              <div className="flex gap-1">
                {(['online', 'offline'] as const).map((t) => (
                  <button key={t} onClick={() => setOrderType(t)}
                    className={`flex-1 text-xs py-1.5 rounded-lg capitalize transition-colors ${orderType === t ? 'bg-[#010521] text-white' : 'bg-[#F0F2F8] text-gray-400'}`}>{t}</button>
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
function extractMemberIdFromQr(value: string) {
  const normalized = decodeURIComponent(value).trim().toUpperCase()
  return normalized.match(/HRM-\d{4}-\d{6}/)?.[0] || ''
}

function MemberQrScanner({
  onClose,
  onDetected,
}: {
  onClose: () => void
  onDetected: (memberId: string) => Promise<boolean>
}) {
  const scannerElementId = `member-qr-reader-${useId().replace(/:/g, '-')}`
  const detectionLocked = useRef(false)
  const [manualMemberId, setManualMemberId] = useState('')
  const [scannerError, setScannerError] = useState('')

  useEffect(() => {
    let disposed = false
    let scanner: import('html5-qrcode').Html5Qrcode | null = null

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (disposed) return
        scanner = new Html5Qrcode(scannerElementId)
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1 },
          async (decodedText) => {
            if (detectionLocked.current) return
            const memberId = extractMemberIdFromQr(decodedText)
            if (!memberId) {
              setScannerError('This QR code is not a valid Hiroma Member ID.')
              return
            }
            detectionLocked.current = true
            setScannerError('')
            const accepted = await onDetected(memberId)
            if (!accepted) {
              setScannerError('Active reseller not found for this Member ID.')
              detectionLocked.current = false
            }
          },
          () => undefined,
        )
      } catch {
        if (!disposed) setScannerError('Camera unavailable. Allow camera access or enter the Member ID below.')
      }
    }

    void startScanner()
    return () => {
      disposed = true
      if (scanner?.isScanning) {
        void scanner.stop().then(() => scanner?.clear()).catch(() => undefined)
      } else {
        scanner?.clear()
      }
    }
  }, [onDetected, scannerElementId])

  const submitManualId = async () => {
    const memberId = extractMemberIdFromQr(manualMemberId)
    if (!memberId) {
      setScannerError('Enter a valid Member ID, for example HRM-2026-000183.')
      return
    }
    setScannerError('')
    const accepted = await onDetected(memberId)
    if (!accepted) setScannerError('Active reseller not found for this Member ID.')
  }

  return (
    <div className="fixed inset-0 z-[80] bg-[#010521]/65 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="member-scanner-title">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close member scanner" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto bg-white shadow-[-24px_0_70px_rgba(1,5,33,.3)]">
        <div className="flex items-start justify-between border-b border-[#0D1B3E]/10 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#C9A84C]">Member identification</p>
            <h2 id="member-scanner-title" className="mt-1 text-xl font-semibold text-[#0D1B3E]">Scan Digital ID QR</h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">Point the camera at the reseller&apos;s Hiroma Digital ID.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-[#F0F2F8] hover:text-[#0D1B3E]" aria-label="Close scanner">✕</button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          <div className="overflow-hidden rounded-2xl border border-[#C9A84C]/45 bg-[#010521] p-2 shadow-[0_14px_35px_rgba(1,5,33,.18)]">
            <div id={scannerElementId} className="min-h-[300px] overflow-hidden rounded-xl" />
          </div>
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 before:h-px before:flex-1 before:bg-[#0D1B3E]/10 after:h-px after:flex-1 after:bg-[#0D1B3E]/10">
            Or enter Member ID
          </div>
          <div className="flex gap-2">
            <input
              value={manualMemberId}
              onChange={(event) => setManualMemberId(event.target.value.toUpperCase())}
              onKeyDown={(event) => { if (event.key === 'Enter') void submitManualId() }}
              placeholder="HRM-2026-000183"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-base font-medium uppercase text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
            />
            <button type="button" onClick={() => void submitManualId()} className="min-h-11 rounded-lg bg-[#010521] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#162850]">
              Find member
            </button>
          </div>
          {scannerError ? <p className="rounded-lg bg-[#fdecea] px-3 py-2 text-xs text-[#a03030]" role="alert">{scannerError}</p> : null}
        </div>
      </aside>
    </div>
  )
}

function CreateResellerOrderModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [customerType, setCustomerType] = useState<'member' | 'non_member' | null>(null)
  const [resellers, setResellers]           = useState<Reseller[]>([])
  const [selectedResellerId, setResellerId] = useState('')
  const [selectedResellerName, setSelectedResellerName] = useState('')
  const [resellerSearch, setResellerSearch] = useState('')
  const [showResellerDrop, setShowResellerDrop] = useState(false)
  const [products, setProducts]             = useState<{ id: string; name: string; type: string; price: number; available_quantity: number }[]>([])
  const [cart, setCart]                     = useState<{ product: { id: string; name: string; type: string; price: number; available_quantity: number }; quantity: number }[]>([])
  const [notes, setNotes]                   = useState('')
  const [customerName, setCustomerName]     = useState('')
  const [cashReceived, setCashReceived]     = useState('')
  const [search, setSearch]                 = useState('')
  const [submitting, setSubmitting]         = useState(false)
  const [error, setError]                   = useState('')
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [showMemberScanner, setShowMemberScanner] = useState(false)
  const [isScannedMemberLocked, setIsScannedMemberLocked] = useState(false)
  const [scanProof, setScanProof] = useState('')
  const scanningMember = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch(`/api/city/orders/reseller-orders?search=${encodeURIComponent(resellerSearch)}`)
        .then((r) => r.json())
        .then((d) => setResellers(d.resellers || []))
    }, 250)
    return () => clearTimeout(timer)
  }, [resellerSearch])

  // Product catalog synchronization follows the selected customer and pricing mode.
  useEffect(() => {
    if (!customerType || (customerType === 'member' && !selectedResellerId)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingProducts(true)
    const priceMode = customerType === 'member' ? 'reseller' : 'srp'
    fetch(`/api/city/products?for_reseller=true&price_mode=${priceMode}`).then((r) => r.json()).then((d) => setProducts(d.products || [])).finally(() => setLoadingProducts(false))
    setCart([])
  }, [customerType, selectedResellerId])

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))

  const updateQty = (productId: string, qty: number) => {
    const current = cart.find((item) => item.product.id === productId)
    if (current && qty > current.product.available_quantity) setError(`Only ${current.product.available_quantity} unit${current.product.available_quantity === 1 ? '' : 's'} of ${current.product.name} are available.`)
    else setError('')
    if (qty <= 0) setCart((prev) => prev.filter((c) => c.product.id !== productId))
    else setCart((prev) => prev.map((c) => {
      if (c.product.id !== productId) return c
      return { ...c, quantity: Math.min(qty, c.product.available_quantity) }
    }))
  }

  const addToCart = (product: typeof products[0]) => {
    const current = cart.find((item) => item.product.id === product.id)
    if (product.available_quantity <= 0) { setError(`${product.name} is currently out of stock.`); return }
    if (current && current.quantity >= product.available_quantity) { setError(`Only ${product.available_quantity} unit${product.available_quantity === 1 ? '' : 's'} of ${product.name} are available.`); return }
    setError('')
    setCart((prev) => {
      const ex = prev.find((c) => c.product.id === product.id)
      if (ex) return prev.map((c) => c.product.id === product.id ? { ...c, quantity: Math.min(c.quantity + 1, product.available_quantity) } : c)
      return [...prev, { product, quantity: 1 }]
    })
  }

  const total = cart.reduce((s, c) => s + c.product.price * c.quantity, 0)
  const cashAmount = Number(cashReceived)
  const hasSufficientPayment =
    cashReceived.trim() !== '' &&
    Number.isFinite(cashAmount) &&
    Math.round(cashAmount * 100) >= Math.round(total * 100)
  const changeAmount = hasSufficientPayment
    ? Math.max(0, Math.round((cashAmount - total) * 100) / 100)
    : 0

  const handleSubmit = async () => {
    if (!customerType) { setError('Choose whether the customer is a reseller/member or non-member.'); return }
    if (customerType === 'member' && !selectedResellerId) { setError('Scan or select the reseller before creating the order.'); return }
    if (cart.length === 0)   { setError('Add at least one item.'); return }
    if (!hasSufficientPayment) {
      setError('Enter cash received equal to or greater than the order total.')
      return
    }
    setSubmitting(true); setError('')
    const res = await fetch('/api/city/orders/reseller-orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reseller_id: customerType === 'member' ? selectedResellerId : null,
        scan_proof: customerType === 'member' ? scanProof : null,
        customer_name: customerType === 'non_member' ? customerName : '',
        notes,
        cash_received: cashAmount,
        items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })),
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) onSuccess()
    else {
      if (data.code === 'INSUFFICIENT_STOCK' && Array.isArray(data.stock_errors)) {
        const availability = new Map<string, number>(data.stock_errors.map((item: { product_id: string; available: number }) => [item.product_id, item.available]))
        setProducts((current) => current.map((product) => availability.has(product.id) ? { ...product, available_quantity: availability.get(product.id)! } : product))
        setCart((current) => current.flatMap((item) => availability.has(item.product.id) ? availability.get(item.product.id)! > 0 ? [{ ...item, product: { ...item.product, available_quantity: availability.get(item.product.id)! }, quantity: Math.min(item.quantity, availability.get(item.product.id)!) }] : [] : [item]))
      }
      setError(data.error || 'Unable to create the order. Please review the details and try again.')
    }
  }

  const identifyScannedMember = useCallback(async (memberId: string) => {
    if (scanningMember.current) return false
    scanningMember.current = true
    setError('')
    try {
      const response = await fetch(`/api/city/orders/reseller-orders?member_id=${encodeURIComponent(memberId)}`)
      const data = await response.json()
      if (!response.ok || !data.reseller || !data.scan_proof) {
        setError(data.error || 'Active reseller not found for this Member ID.')
        return false
      }
      const reseller = data.reseller as Reseller
      setResellerId(reseller.id)
      setScanProof(data.scan_proof)
      setSelectedResellerName(reseller.full_name)
      setResellerSearch('')
      setCustomerName('')
      setShowResellerDrop(false)
      setIsScannedMemberLocked(true)
      setShowMemberScanner(false)
      return true
    } catch {
      setError('Unable to verify this member right now. Please try again.')
      return false
    } finally {
      scanningMember.current = false
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="relative flex h-[min(92vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[#0D1B3E]">Create Walk-in Order</h2>
            <p className="mt-0.5 text-sm text-gray-500">Walk-in / in-person order — marked as delivered immediately</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {customerType && <button type="button" onClick={() => { setCustomerType(null); setResellerId(''); setSelectedResellerName(''); setResellerSearch(''); setScanProof(''); setIsScannedMemberLocked(false); setCustomerName(''); setCart([]); setError('') }} className="min-h-11 rounded-lg border border-[#0D1B3E]/15 bg-white px-4 py-2 text-sm font-bold text-[#0D1B3E] hover:bg-[#F0F2F8]">← Change type</button>}
            <button onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-lg text-xl text-gray-400 hover:bg-[#F0F2F8] hover:text-[#0D1B3E]" aria-label="Close walk-in order">✕</button>
          </div>
        </div>
        {!customerType ? <div className="space-y-6 overflow-y-auto p-6"><div className="text-center"><p className="text-sm font-bold uppercase tracking-[.16em] text-[#C9A84C]">Step 1 of 2</p><h3 className="mt-1 text-2xl font-bold text-[#0D1B3E]">Who is buying?</h3><p className="mt-2 text-base text-gray-500">Choose first so the correct customer identification and pricing will be used.</p></div><div className="grid gap-4 sm:grid-cols-2"><button type="button" onClick={() => setCustomerType('member')} className="min-h-44 rounded-2xl border-2 border-[#0D1B3E]/10 p-6 text-left transition hover:border-[#C9A84C] hover:bg-[#fffaf0]"><span className="text-3xl">▣</span><b className="mt-3 block text-lg text-[#0D1B3E]">Reseller / Member</b><span className="mt-2 block text-sm leading-6 text-gray-600">Scan the member QR or search the nationwide reseller username. Uses reseller pricing.</span><span className="mt-4 block text-sm font-bold text-[#9a7418]">Continue as member →</span></button><button type="button" onClick={() => setCustomerType('non_member')} className="min-h-44 rounded-2xl border-2 border-[#0D1B3E]/10 p-6 text-left transition hover:border-[#0D1B3E] hover:bg-[#f7f8fc]"><span className="text-3xl">👤</span><b className="mt-3 block text-lg text-[#0D1B3E]">Non-member / SRP Customer</b><span className="mt-2 block text-sm leading-6 text-gray-600">No member account required. Customer name is optional. Uses SRP pricing.</span><span className="mt-4 block text-sm font-bold text-[#0D1B3E]">Continue as non-member →</span></button></div></div> : <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex min-h-[280px] min-w-0 flex-1 flex-col border-b border-[#0D1B3E]/8 md:min-h-0 md:border-b-0 md:border-r">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0 space-y-2">
              {customerType === 'member' && <div className="relative">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label className="block text-sm font-medium text-gray-600">
                    {isScannedMemberLocked ? 'Verified reseller (locked)' : 'Find reseller/member nationwide'}
                  </label>
                  <button
                    type="button"
                    onClick={() => { setError(''); setShowMemberScanner(true) }}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#C9A84C]/55 bg-[#fef9ee] px-4 py-2.5 text-sm font-bold text-[#795515] transition-colors hover:bg-[#f8edcf]"
                  >
                    <span aria-hidden="true">▣</span> {isScannedMemberLocked ? 'Rescan Member QR' : 'Scan Member QR'}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={resellerSearch || selectedResellerName}
                    readOnly={isScannedMemberLocked}
                    aria-readonly={isScannedMemberLocked}
                    onChange={(e) => {
                      if (isScannedMemberLocked) return
                      setResellerSearch(e.target.value)
                      setShowResellerDrop(true)
                      if (!e.target.value) { setResellerId(''); setSelectedResellerName(''); setScanProof('') }
                    }}
                    onFocus={() => { if (!isScannedMemberLocked) setShowResellerDrop(true) }}
                    onBlur={() => setTimeout(() => setShowResellerDrop(false), 150)}
                    placeholder="Enter reseller username or name…"
                    className={`min-h-12 w-full rounded-lg border px-4 py-3 pr-10 text-base text-[#0D1B3E] outline-none placeholder:text-gray-500 ${
                      isScannedMemberLocked
                        ? 'cursor-not-allowed border-emerald-300 bg-emerald-50 font-medium'
                        : 'border-[#0D1B3E]/15 bg-[#F0F2F8] focus:border-[#C9A84C]'
                    }`}
                  />
                  {isScannedMemberLocked && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-emerald-600" aria-label="Verified reseller locked">🔒</span>
                  )}
                  {selectedResellerId && !isScannedMemberLocked && (
                    <button onClick={() => { setResellerId(''); setSelectedResellerName(''); setResellerSearch(''); setScanProof('') }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#0D1B3E] text-xs">✕</button>
                  )}
                </div>
                {showResellerDrop && !isScannedMemberLocked && (
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
                            if (!r.member_id) {
                              setError('This reseller does not have an active Member ID yet.')
                              return
                            }
                            void identifyScannedMember(r.member_id)
                          }}
                          className={`px-3 py-2.5 cursor-pointer hover:bg-[#F0F2F8] transition-colors ${selectedResellerId === r.id ? 'bg-[#F0F2F8]' : ''}`}>
                          <p className="text-sm font-semibold text-[#0D1B3E]">{r.full_name}</p>
                          <p className="mt-0.5 text-xs text-gray-500">@{r.username}</p>
                        </div>
                      ))
                    }
                    {resellers.filter((r) =>
                      !resellerSearch ||
                      r.full_name.toLowerCase().includes(resellerSearch.toLowerCase()) ||
                      r.username.toLowerCase().includes(resellerSearch.toLowerCase())
                    ).length === 0 && (
                      <p className="px-3 py-4 text-center text-sm text-gray-500">No reseller found</p>
                    )}
                  </div>
                )}
              </div>}
              {customerType === 'non_member' && (
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name (optional)"
                  className="min-h-12 w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-4 py-3 text-base text-[#0D1B3E] outline-none placeholder:text-gray-500 focus:border-[#C9A84C]" />
              )}
              <p className="text-xs font-semibold leading-5 text-[#8a641b]">
                Customer: {customerType === 'member' ? selectedResellerId ? `Verified member · ${selectedResellerName}` : 'Member identification required' : 'Non-member'} · Pricing: {customerType === 'member' ? 'Reseller Price' : 'SRP'}
              </p>
              {(customerType === 'non_member' || selectedResellerId) && <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..."
                className="min-h-12 w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-4 py-3 text-base text-[#0D1B3E] outline-none placeholder:text-gray-500 focus:border-[#C9A84C]" />
              }
            </div>
            <div className="flex-1 overflow-y-auto">
              {customerType === 'member' && !selectedResellerId ? <div className="m-4 rounded-xl border border-blue-100 bg-blue-50 p-6 text-center"><b className="text-base text-[#0D1B3E]">Identify the member first</b><p className="mt-2 text-sm leading-6 text-gray-600">Scan their Digital ID QR or search their reseller username above. Products will appear after verification.</p></div> : loadingProducts ? <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" /></div>
                : filtered.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">No products in stock</p>
                : filtered.map((product) => {
                  const quantityInCart = cart.find((item) => item.product.id === product.id)?.quantity || 0
                  const reachedLimit = quantityInCart >= product.available_quantity
                  return (
                  <div key={product.id} className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors">
                    <div>
                      <p className="text-sm font-semibold text-[#0D1B3E]">{product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`rounded px-2 py-1 text-xs ${product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>{product.type}</span>
                        <span className="text-sm text-gray-600">₱{Number(product.price).toLocaleString()}</span>
                        <span className="text-sm text-gray-500">· {product.available_quantity} in stock</span>
                      </div>
                    </div>
                    <button onClick={() => addToCart(product)} disabled={product.available_quantity <= 0 || reachedLimit} className="min-h-11 rounded-lg bg-[#010521] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#162850] disabled:cursor-not-allowed disabled:opacity-35">{product.available_quantity <= 0 ? 'No stock' : reachedLimit ? 'Max added' : '+ Add'}</button>
                  </div>
                )})}
            </div>
          </div>
          <div className="flex max-h-[48%] w-full flex-shrink-0 flex-col bg-white md:max-h-none md:w-80 lg:w-96">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <p className="text-base font-semibold text-[#0D1B3E]">Order Summary</p>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {cart.length === 0 ? <p className="pt-5 text-center text-sm text-gray-500">No items yet</p> : (
                cart.map((c) => (
                  <div key={c.product.id} className="rounded-xl border border-[#0D1B3E]/8 bg-[#f8f9fc] p-3 text-sm">
                    <div className="flex items-start justify-between gap-3"><p className="min-w-0 flex-1 truncate font-semibold text-[#0D1B3E]">{c.product.name}</p><span className="flex-shrink-0 font-bold text-[#0D1B3E]">₱{(c.product.price * c.quantity).toLocaleString()}</span></div>
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => updateQty(c.product.id, c.quantity - 1)}
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#e8ebf3] text-base font-bold text-[#0D1B3E]">−</button>
                      <input type="number" min={1} max={c.product.available_quantity} value={c.quantity}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) updateQty(c.product.id, v) }}
                        className="h-9 w-14 rounded-lg border border-[#0D1B3E]/15 bg-white text-center text-base text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
                      <button onClick={() => updateQty(c.product.id, c.quantity + 1)}
                        disabled={!!c.product.available_quantity && c.quantity >= c.product.available_quantity}
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#e8ebf3] text-base font-bold text-[#0D1B3E] disabled:opacity-30">+</button>
                      <span className="ml-auto text-xs text-gray-500">₱{c.product.price.toLocaleString()} each</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-[#0D1B3E]/8 flex-shrink-0 space-y-3">
              <div className="flex justify-between text-xs font-semibold text-[#0D1B3E]"><span>Total</span><span>₱{total.toLocaleString()}</span></div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-[#0D1B3E]">Cash received *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base text-gray-500">₱</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={cashReceived}
                    onChange={(event) => {
                      setCashReceived(event.target.value)
                      setError('')
                    }}
                    placeholder="0.00"
                    className="min-h-12 w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] py-3 pl-8 pr-3 text-base text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                  />
                </div>
                {cashReceived.trim() !== '' && Number.isFinite(cashAmount) && (
                  <p className={`mt-1.5 text-sm font-medium ${hasSufficientPayment ? 'text-[#1a7a4a]' : 'text-[#a03030]'}`}>
                    {hasSufficientPayment
                      ? `Change: ₱${changeAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : `Insufficient by ₱${Math.max(0, total - cashAmount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-[#0D1B3E]/10 bg-[#f8f9fc] px-3 py-2.5 text-sm text-gray-600"><span className="font-semibold text-[#0D1B3E]">Sales channel:</span> Walk-in / Offline <span className="text-xs text-gray-500">(automatic)</span></div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
                className="w-full resize-none rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-3 text-base text-[#0D1B3E] outline-none placeholder:text-gray-500 focus:border-[#C9A84C]" />
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium leading-5 text-[#a03030]">{error}</p>}
              <button onClick={handleSubmit} disabled={submitting || cart.length === 0 || !hasSufficientPayment || (customerType === 'member' && !selectedResellerId)}
                className="min-h-12 w-full rounded-lg bg-[#C9A84C] py-3 text-base font-bold text-white transition-colors hover:bg-[#b8963e] disabled:opacity-50">
                {submitting ? 'Creating...' : 'Create & Deliver'}
              </button>
            </div>
          </div>
        </div>}
      </div>
      {showMemberScanner ? (
        <MemberQrScanner
          onClose={() => setShowMemberScanner(false)}
          onDetected={identifyScannedMember}
        />
      ) : null}
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function CityOrdersPage() {
  const [tab, setTab]                       = useState<'my_orders' | 'reseller_orders'>('reseller_orders')
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
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null)
  const [supplier, setSupplier]             = useState<Supplier | null>(null)
  const [showCreate, setShowCreate]         = useState(false)
  const [selectedOrder, setSelectedOrder]   = useState<Order | null>(null)
  const [showResellerOrder, setShowResellerOrder] = useState(false)
  const [summary, setSummary]               = useState({ total: 0, pending: 0, processing: 0, ready_for_pickup: 0, delivered: 0, cancelled: 0 })

  // Open the requested walk-in workflow once after navigation from the dashboard.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('action') !== 'walk-in') return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab('reseller_orders')
    setShowResellerOrder(true)
    params.delete('action')
    const remainingQuery = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}`
    )
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // eslint-disable-next-line react-hooks/set-state-in-effect
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
            className="bg-[#010521] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#162850] transition-colors font-medium">
            + Walk-in Order
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        {([
          { key: 'reseller_orders', label: 'Reseller Orders', desc: 'From resellers' },
          { key: 'my_orders',       label: 'My Orders',       desc: 'To supplier' },
        ] as const).map((t) => (
          <button key={t.key}
            onClick={() => { setTab(t.key); setStatusFilter('all'); setTypeFilter('all'); setSearch(''); setSearchInput('') }}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === t.key ? 'bg-[#010521] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}<span className="ml-1.5 text-xs opacity-60">{t.desc}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        {[
          { label: 'Total',      value: summary.total,      accent: '#0D1B3E' },
          { label: 'Pending',    value: summary.pending,    accent: '#C9A84C' },
          { label: 'Processing', value: summary.processing, accent: '#0D1B3E' },
          { label: 'Ready for Pickup', value: summary.ready_for_pickup, accent: '#2563eb' },
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
            placeholder={tab === 'my_orders' ? 'Search supplier...' : 'Search any reseller...'}
            className="flex-1 min-w-[180px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />
          <div className="flex gap-1 flex-wrap">
            {(['all', 'pending', 'processing', 'ready_for_pickup', 'delivered', 'cancelled'] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${statusFilter === f ? 'bg-[#010521] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'}`}>{f}</button>
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
            {tab === 'my_orders' ? 'No purchase orders yet. Click "+ New Order" to place one.' : search ? `No orders found for "${search}"` : 'No reseller orders yet.'}
          </div>
        ) : (
          orders.map((order) => {
            const counterparty = order.is_non_member_sale && tab === 'reseller_orders'
              ? { full_name: order.customer_name || 'Walk-in Customer', username: 'non-member', role: 'Non-member' }
              : tab === 'my_orders' ? order.seller : order.buyer
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
                  <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${STATUS_COLORS[order.status] || ''}`}>{order.status === 'ready_for_pickup' ? 'Ready for Pickup' : order.status}</span>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => setSelectedOrder(order)} className="w-7 h-7 rounded-lg bg-[#eef0f8] hover:bg-[#C9A84C] flex items-center justify-center transition-colors group flex-shrink-0" title="View details" aria-label={`View order ${order.order_number || order.id}`}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    {/* Confirm payment button */}
                    {tab === 'reseller_orders' && order.payment_method === 'cash_on_pickup' && order.payment_status !== 'paid' && order.status !== 'cancelled' && (
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
                      <button key={next}
                        disabled={updatingId === order.id || (next === 'processing' && !canProcess(order))}
                        onClick={() => next === 'cancelled' ? setCancelConfirm(order.id) : handleStatusUpdate(order.id, next)}
                        className={"w-7 h-7 rounded-lg flex items-center justify-center transition-colors group flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed " + (next === 'cancelled' ? 'bg-[#fdecea] hover:bg-[#a03030]' : next === 'delivered' ? 'bg-[#e8f7ef] hover:bg-[#1a7a4a]' : next === 'ready_for_pickup' ? 'bg-[#f0f7ff] hover:bg-[#2563eb]' : next === 'processing' && !canProcess(order) ? 'bg-[#f1f5f9]' : 'bg-[#eef0f8] hover:bg-[#010521]')}
                        title={next === 'processing' && !canProcess(order) ? 'Mark as paid first' : next === 'processing' ? 'Mark Processing' : next === 'ready_for_pickup' ? 'Mark Ready for Pickup' : next === 'delivered' ? 'Mark Delivered' : 'Cancel'}>
                        {next === 'cancelled' ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#a03030] group-hover:text-white"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        ) : next === 'delivered' ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1a7a4a] group-hover:text-white"><path d="M5 13l4 4L19 7"/></svg>
                        ) : next === 'ready_for_pickup' ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#2563eb] group-hover:text-white"><path d="M3 9l2-5h14l2 5"/><path d="M5 9v10h14V9"/><path d="M9 19v-6h6v6"/></svg>
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

      {selectedOrder && <CityOrderDetailsModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}

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
