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
  owner: {
    id: string
    full_name: string
    username: string
    role: string
    distributor_profile?: { dist_level: string } | null
  }
  product: {
    id: string; name: string; type: string
    price: number; cost_price: number; regional_price: number; provincial_price: number
    city_price: number; branch_price: number; reseller_price: number
  }
  movement: {
    quantity: number | null
    reference_value: number
    sale_value: number
    admin_profit: number
    is_sale: boolean
    admin_stock_before: number | null
    admin_stock_after: number | null
    recipient_stock_before: number | null
    recipient_stock_after: number
    created_at: string | null
    is_legacy: boolean
  }
}

interface Distributor {
  id: string; full_name: string; username: string; role: string
  distributor_profile?: { dist_level: string } | null
}

interface Reseller {
  id: string; full_name: string; username: string
}

interface ProductStock {
  id: string; name: string; type: string
  price: number; cost_price: number; regional_price: number; provincial_price: number
  city_price: number; branch_price: number; reseller_price: number
  total_distributed: number; is_low_stock: boolean; admin_stock: number
  reseller_units: number; admin_reserved: number; admin_available: number
}

interface CompanyStockSummary {
  on_hand_units: number
  reserved_units: number
  available_units: number
  current_cost_value: number
  products_with_stock: number
  low_stock_products: number
  distributed_units: number
  reseller_units: number
  admin_breakdown: { product_name: string; on_hand: number; reserved: number; available: number; current_cost_value: number; low_stock_threshold: number }[]
  network_breakdown: { product_name: string; level: string; units: number }[]
  reseller_breakdown: { product_name: string; units: number }[]
}

interface CartItem {
  product: ProductStock
  quantity: number
}

interface StockReceipt {
  id: string
  reference_number: string
  source_type: string
  source_reference: string
  total_units: number
  notes: string | null
  received_at: string
  items: Array<{ product_id: string; quantity: number; unit_cost: number; stock_before: number; stock_after: number }>
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
  branch:     'branch_price',
  reseller:   'reseller_price',
}

const PRICE_LABEL: Record<string, string> = {
  regional:   'Regional Price',
  provincial: 'Provincial Price',
  city:       'City Price',
  branch:     'Branch Price',
  reseller:   'Reseller Price',
}

const displayLevel = (user: { role: string; distributor_profile?: { dist_level: string } | null }) =>
  user.distributor_profile?.dist_level === 'branch'
    ? 'branch'
    : user.distributor_profile?.dist_level || user.role

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
  const [sourceType, setSourceType] = useState<'production' | 'supplier_purchase' | 'approved_adjustment'>('production')
  const [sourceReference, setSourceReference] = useState('')
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
    if (sourceReference.trim().length < 3) { setError('Enter the batch, supplier receipt, or approval reference.'); return }
    if (sourceType === 'approved_adjustment' && notes.trim().length < 3) { setError('Enter the approved adjustment reason.'); return }
    setSubmitting(true); setError('')
    const res = await fetch('/api/admin/inventory', {
      method:  'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes,
        source_type: sourceType,
        source_reference: sourceReference.trim(),
        items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })),
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) {
      setSuccess(data.message || 'Stock added successfully.')
      setTimeout(() => { onSuccess(); onClose() }, 1500)
    } else {
      setError(
        res.status === 401
          ? 'Your admin session has expired. Please sign in again, then retry.'
          : data.error || 'Something went wrong.'
      )
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
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${inCart ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#010521] text-white hover:bg-[#162850]'}`}>
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
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#C9A84C]">
                <option value="production">Production batch</option>
                <option value="supplier_purchase">Supplier purchase</option>
                <option value="approved_adjustment">Approved adjustment</option>
              </select>
              <input value={sourceReference} onChange={(e) => setSourceReference(e.target.value)}
                maxLength={120}
                placeholder={sourceType === 'production' ? 'Batch reference' : sourceType === 'supplier_purchase' ? 'Supplier receipt / invoice' : 'Approval reference'}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                placeholder={sourceType === 'approved_adjustment' ? 'Required adjustment reason' : 'Optional notes'} rows={2}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#C9A84C] resize-none placeholder:text-gray-400" />
              {error   && <p className="text-xs text-[#a03030]">{error}</p>}
              {success && <p className="text-xs text-[#1a7a4a] bg-[#e8f7ef] px-2 py-1.5 rounded-lg">{success}</p>}
              <button onClick={handleSubmit} disabled={submitting || cart.length === 0}
                className="w-full bg-[#010521] text-white text-xs py-2 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-50 font-medium">
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

type StockWorkflow = 'branch_transfer' | 'distributor_sale'

function AssignStockModal({
  workflow,
  distributors,
  products,
  onClose,
  onSuccess,
}: {
  workflow:     StockWorkflow
  distributors: Distributor[]
  products:     ProductStock[]
  onClose:      () => void
  onSuccess:    () => void
}) {
  const [ownerId, setOwnerId]           = useState('')
  const [cart, setCart]                 = useState<CartItem[]>([])
  const [notes, setNotes]               = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState('')
  const [success, setSuccess]           = useState('')
  const [search, setSearch]             = useState('')
  const [recipientSearch, setRecipientSearch] = useState('')
  const [recipientRole, setRecipientRole]     = useState<'all'|'regional'|'provincial'|'city'|'reseller'>('all')
  const [recipientPage, setRecipientPage]     = useState(1)
  const [recipients, setRecipients]           = useState<Distributor[]>([])
  const [recipientLoading, setRecipientLoading] = useState(false)
  const [recipientMeta, setRecipientMeta]     = useState({ total: 0, totalPages: 1 })
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [confirmationReference, setConfirmationReference] = useState('')

  const selectedDist = distributors.find((d) => d.id === ownerId) || recipients.find((r) => r.id === ownerId)
  const selectedLevel = selectedDist?.distributor_profile?.dist_level === 'branch' ? 'branch' : selectedDist?.role
  const isBranchTransfer = selectedLevel === 'branch'
  const isTransferWorkflow = workflow === 'branch_transfer'
  const priceKey     = selectedLevel ? PRICE_KEY[selectedLevel] : null
  const unitPrice = (product: ProductStock) => {
    if (!priceKey) return 0
    const configured = Number(product[priceKey])
    return selectedLevel === 'branch' && configured <= 0 ? Number(product.cost_price) : configured
  }

  // Search recipients from API
  useEffect(() => {
    if (ownerId) return
    setRecipientLoading(true)
    const params = new URLSearchParams({
      recipient_search: recipientSearch,
      recipient_role:   recipientRole,
      recipient_scope:  isTransferWorkflow ? 'branch' : 'sale',
      recipient_page:   String(recipientPage),
    })
    fetch(`/api/admin/inventory?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setRecipients(data.recipients || [])
        setRecipientMeta(data.recipientMeta || { total: 0, totalPages: 1 })
      })
      .finally(() => setRecipientLoading(false))
  }, [recipientSearch, recipientRole, recipientPage, ownerId, isTransferWorkflow])

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
    ? cart.reduce((s, c) => s + unitPrice(c.product) * c.quantity, 0)
    : 0

  const reviewTransaction = () => {
    if (!ownerId)          { setError(isTransferWorkflow ? 'Please select a Hiroma Branch.' : 'Please select a distributor or reseller.'); return }
    if (cart.length === 0) { setError('Add at least one product.'); return }
    if (isTransferWorkflow !== isBranchTransfer) {
      setError(isTransferWorkflow
        ? 'Internal transfers can only be sent to a Hiroma Branch.'
        : 'Hiroma Branches must use the internal transfer workflow.')
      return
    }
    setError('')
    setShowConfirmation(true)
  }

  const handleSubmit = async () => {
    setSubmitting(true); setError('')

    const res = await fetch('/api/admin/inventory', {
      method:  'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_id: ownerId,
        workflow,
        notes,
        items: cart.map((c) => ({ product_id: c.product.id, quantity: c.quantity })),
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) {
      setSuccess(data.message || 'Stock assigned successfully.')
      setConfirmationReference(data.reference_number || '')
      onSuccess()
    } else {
      setError(data.error || 'Something went wrong.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">
              {isTransferWorkflow ? 'Transfer Stock to Branch' : 'Sell / Assign Stock to Distributor'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {isTransferWorkflow
                ? 'Internal company transfer only — no sale, revenue, receivable, commission, or payout'
                : 'Commercial stock sale — priced at the recipient level and recorded as a delivered order'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* Left — products */}
          <div className="flex-1 flex flex-col border-b lg:border-b-0 lg:border-r border-[#0D1B3E]/8 min-w-0 min-h-[22rem] lg:min-h-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0 space-y-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  {isTransferWorkflow ? 'Destination Branch *' : 'Distributor / Reseller *'}
                </label>
                {selectedDist ? (
                  <div className="flex items-center justify-between bg-[#F0F2F8] border border-[#C9A84C] rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-[#0D1B3E]">{selectedDist.full_name}</p>
                      <p className="text-[10px] text-gray-400">@{selectedDist.username} · <span className="capitalize">{selectedLevel}</span> · {selectedLevel ? PRICE_LABEL[selectedLevel] : ''}</p>
                    </div>
                    <button onClick={() => { setOwnerId(''); setCart([]) }} className="text-gray-400 hover:text-[#a03030] text-xs ml-2">✕</button>
                  </div>
                ) : (
                  <div>
                    <div className="relative">
                      <input
                        value={recipientSearch}
                        onChange={(e) => { setRecipientSearch(e.target.value); setRecipientPage(1) }}
                        placeholder={isTransferWorkflow ? 'Search branch by name or username...' : 'Search distributor or reseller...'}
                        className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400"
                      />
                      {recipientLoading && (
                        <div className="absolute right-3 top-2.5 w-4 h-4 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                    {!isTransferWorkflow && <div className="flex gap-1 mt-1.5 flex-wrap">
                      {(['all', 'regional', 'provincial', 'city', 'reseller'] as const).map((r) => (
                        <button key={r} onClick={() => { setRecipientRole(r); setRecipientPage(1) }}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize ${recipientRole === r ? 'bg-[#010521] text-white border-[#0D1B3E]' : 'border-[#0D1B3E]/15 text-gray-500 hover:border-[#0D1B3E]/30'}`}>
                          {r}
                        </button>
                      ))}
                    </div>}
                    {recipients.length > 0 && (
                      <div className="mt-1.5 border border-[#0D1B3E]/10 rounded-lg overflow-hidden">
                        {recipients.map((r) => (
                          <button key={r.id} onClick={() => { setOwnerId(r.id); setCart([]) }}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#F0F2F8] text-left border-b border-[#0D1B3E]/5 last:border-0 transition-colors">
                            <div>
                              <p className="text-xs font-medium text-[#0D1B3E]">{r.full_name}</p>
                              <p className="text-[10px] text-gray-400">@{r.username}</p>
                            </div>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full capitalize ${
                              r.role === 'reseller'   ? 'bg-[#fef9ee] text-[#9a6f1e]' :
                              r.role === 'city'       ? 'bg-[#e8f7ef] text-[#1a7a4a]' :
                              r.role === 'provincial' ? 'bg-[#f0f7ff] text-[#2563eb]' :
                                                        'bg-[#eef0f8] text-[#0D1B3E]'
                            }`}>{displayLevel(r) === 'branch' ? 'Branch' : r.role}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {recipientMeta.totalPages > 1 && (
                      <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-400">
                        <span>{recipientMeta.total} results</span>
                        <div className="flex gap-1 items-center">
                          <button disabled={recipientPage === 1} onClick={() => setRecipientPage(p => p - 1)}
                            className="w-5 h-5 rounded bg-[#F0F2F8] hover:bg-[#010521] hover:text-white disabled:opacity-30 flex items-center justify-center">‹</button>
                          <span>{recipientPage}/{recipientMeta.totalPages}</span>
                          <button disabled={recipientPage === recipientMeta.totalPages} onClick={() => setRecipientPage(p => p + 1)}
                            className="w-5 h-5 rounded bg-[#F0F2F8] hover:bg-[#010521] hover:text-white disabled:opacity-30 flex items-center justify-center">›</button>
                        </div>
                      </div>
                    )}
                    {recipientSearch.length > 0 && recipients.length === 0 && !recipientLoading && (
                      <p className="text-[10px] text-gray-400 mt-1.5 text-center">No results found</p>
                    )}
                  </div>
                )}
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..." disabled={!ownerId}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400 disabled:opacity-50" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {!ownerId ? (
                <p className="text-center text-xs text-gray-400 py-8">
                  {isTransferWorkflow ? 'Select a destination Branch first' : 'Select a distributor or reseller first'}
                </p>
              ) : filtered.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-8">No products found</p>
              ) : (
                filtered.map((product) => {
                  const price  = unitPrice(product)
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
                            : 'bg-[#010521] text-white hover:bg-[#162850]'
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
          <div className="w-full lg:w-80 xl:w-96 flex flex-col flex-shrink-0 min-h-[18rem] lg:min-h-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <p className="text-xs font-semibold text-[#0D1B3E]">
                {isTransferWorkflow ? 'Transfer Summary' : 'Sale Summary'}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-28">
              {cart.length === 0 ? (
                <p className="text-xs text-gray-400 text-center pt-4">No items yet</p>
              ) : (
                cart.map((c) => {
                  const price = unitPrice(c.product)
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
                <span>{isTransferWorkflow ? 'Reference Value' : 'Sale Total'}</span>
                <span>₱{total.toLocaleString()}</span>
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)" rows={2}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#C9A84C] resize-none placeholder:text-gray-400" />
              {error   && <p className="text-xs text-[#a03030]">{error}</p>}
              {success && <p className="text-xs text-[#1a7a4a] bg-[#e8f7ef] px-2 py-1.5 rounded-lg">{success}</p>}
              <button onClick={reviewTransaction} disabled={submitting || cart.length === 0 || !ownerId}
                className="w-full bg-[#C9A84C] text-white text-xs py-2 rounded-lg hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium">
                {isTransferWorkflow ? 'Review Stock Transfer' : 'Review Stock Sale'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showConfirmation && selectedDist && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#010521]/70 p-3 sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#0D1B3E]/8 px-5 py-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">Review & confirm</p>
                <h3 className="mt-1 text-base font-semibold text-[#0D1B3E]">
                  {isTransferWorkflow ? 'Confirm Internal Stock Transfer' : 'Confirm Stock Sale'}
                </h3>
              </div>
              <button type="button" onClick={() => {
                if (success) onClose()
                else setShowConfirmation(false)
              }} disabled={submitting}
                className="text-xl leading-none text-gray-400 hover:text-[#0D1B3E] disabled:opacity-40">×</button>
            </div>

            <div className="overflow-y-auto p-5">
              {success ? (
                <div className="mb-4 rounded-xl border border-[#1a7a4a]/25 bg-[#e8f7ef] px-4 py-3">
                  <p className="text-xs font-semibold text-[#1a7a4a]">✓ Transaction completed successfully</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#38684f]">{success}</p>
                  {confirmationReference && (
                    <p className="mt-2 text-[11px] font-semibold text-[#0D1B3E]">
                      Transfer reference: {confirmationReference}
                    </p>
                  )}
                  <p className="mt-2 text-[10px] text-gray-500">This confirmation will remain open until you click Done.</p>
                </div>
              ) : (
                <div className={`mb-4 rounded-xl border px-4 py-3 text-xs ${isTransferWorkflow ? 'border-[#C9A84C]/35 bg-[#fef9ee] text-[#80611f]' : 'border-[#2563eb]/20 bg-[#f0f7ff] text-[#1d4e9e]'}`}>
                  {isTransferWorkflow
                    ? 'Internal company movement only. This will reduce Admin inventory and increase Branch inventory without recording revenue, receivable, commission, or payout.'
                    : 'Commercial transaction. This will reduce Admin inventory, increase recipient inventory, and create a delivered sale using the recipient-level price.'}
                </div>
              )}

              <div className="grid gap-3 rounded-xl bg-[#F0F2F8] p-4 sm:grid-cols-2">
                <div><p className="text-[10px] uppercase text-gray-400">{isTransferWorkflow ? 'Destination Branch' : 'Buyer / Recipient'}</p><p className="mt-1 text-sm font-semibold text-[#0D1B3E]">{selectedDist.full_name}</p><p className="text-[10px] text-gray-400">@{selectedDist.username}</p></div>
                <div className="sm:text-right"><p className="text-[10px] uppercase text-gray-400">Classification</p><p className="mt-1 text-sm font-semibold text-[#0D1B3E]">{isTransferWorkflow ? 'Internal Transfer · No Sale' : 'Delivered Commercial Sale'}</p></div>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-[#0D1B3E]/10">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-[#F0F2F8] px-4 py-2 text-[10px] font-semibold uppercase text-gray-500"><span>Product</span><span>Qty</span><span>Value</span></div>
                {cart.map((item) => {
                  const price = unitPrice(item.product)
                  return (
                    <div key={item.product.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-[#0D1B3E]/5 px-4 py-3 text-xs">
                      <div className="min-w-0"><p className="truncate font-medium text-[#0D1B3E]">{item.product.name}</p><p className="text-[10px] text-gray-400">₱{price.toLocaleString()} each</p></div>
                      <span className="font-medium text-[#0D1B3E]">{item.quantity.toLocaleString()}</span>
                      <span className="min-w-20 text-right font-semibold text-[#0D1B3E]">₱{(price * item.quantity).toLocaleString()}</span>
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 flex items-end justify-between gap-4">
                <div><p className="text-[10px] uppercase text-gray-400">Total units</p><p className="mt-1 text-sm font-semibold text-[#0D1B3E]">{cart.reduce((sum, item) => sum + item.quantity, 0).toLocaleString()}</p></div>
                <div className="text-right"><p className="text-[10px] uppercase text-gray-400">{isTransferWorkflow ? 'Reference value' : 'Sale total'}</p><p className="mt-1 text-xl font-bold text-[#0D1B3E]">₱{total.toLocaleString()}</p></div>
              </div>
              {notes.trim() && <div className="mt-4 rounded-xl border border-[#0D1B3E]/8 p-3"><p className="text-[10px] uppercase text-gray-400">Notes</p><p className="mt-1 text-xs text-gray-600">{notes.trim()}</p></div>}
              {error && <p className="mt-3 text-xs text-[#a03030]">{error}</p>}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-[#0D1B3E]/8 px-5 py-4 sm:flex-row sm:justify-end">
              {success ? (
                <button type="button" onClick={onClose}
                  className="rounded-lg bg-[#010521] px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#162850]">
                  Done
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => setShowConfirmation(false)} disabled={submitting}
                    className="rounded-lg border border-[#0D1B3E]/15 px-4 py-2.5 text-xs font-medium text-[#0D1B3E] hover:bg-[#F0F2F8] disabled:opacity-40">Go Back</button>
                  <button type="button" onClick={handleSubmit} disabled={submitting}
                    className="rounded-lg bg-[#010521] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#162850] disabled:opacity-50">
                    {submitting ? 'Processing...' : (isTransferWorkflow ? 'Yes, Transfer Stock' : 'Yes, Record Sale')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function AdminInventoryPage() {
  const [tab, setTab]                   = useState<'stock' | 'receipts' | 'distributed'>('stock')
  const [stockPage, setStockPage]       = useState(1)
  const [stockSearch, setStockSearch]   = useState('')
  const [stockSearchInput, setStockSearchInput] = useState('')
  const [stockMeta, setStockMeta]       = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [items, setItems]               = useState<InventoryItem[]>([])
  const [productStock, setProductStock] = useState<ProductStock[]>([])
  const [stockReceipts, setStockReceipts] = useState<StockReceipt[]>([])
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [meta, setMeta]                 = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]           = useState(true)
  const [ownerFilter, setOwnerFilter]   = useState('')
  const [searchInput, setSearchInput]   = useState('')
  const [search, setSearch]             = useState('')
  const [typeFilter, setTypeFilter]     = useState('all')
  const [page, setPage]                 = useState(1)
  const [stockWorkflow, setStockWorkflow] = useState<StockWorkflow | null>(null)
  const [showProduction, setShowProduction] = useState(false)
  const [editingId, setEditingId]       = useState<string | null>(null)
  const [editThreshold, setEditThreshold] = useState('')
  const [saving, setSaving]             = useState(false)
  const [adminRevenue, setAdminRevenue]         = useState(0)
  const [adminTotalOrders, setAdminTotalOrders] = useState(0)
  const [companyStockSummary, setCompanyStockSummary] = useState<CompanyStockSummary>({ on_hand_units: 0, reserved_units: 0, available_units: 0, current_cost_value: 0, products_with_stock: 0, low_stock_products: 0, distributed_units: 0, reseller_units: 0, admin_breakdown: [], network_breakdown: [], reseller_breakdown: [] })
  const [selectedStockCard, setSelectedStockCard] = useState<'on_hand' | 'available' | 'cost' | 'network' | 'reseller' | 'low_stock' | null>(null)

  useEffect(() => {
    if (!selectedStockCard) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedStockCard(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selectedStockCard])

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
        setStockReceipts(data.stockReceipts || [])
        setAdminRevenue(data.adminRevenue || 0)
        setAdminTotalOrders(data.adminTotalOrders || 0)
        if (data.companyStockSummary) setCompanyStockSummary(data.companyStockSummary)
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

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Inventory Management</h1>
          <p className="text-sm text-gray-400 mt-0.5">Assign stock to distributors and resellers — Hiroma Branch assignments are internal no-sale transfers</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowProduction(true)}
            className="bg-[#010521] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#162850] transition-colors font-medium">
            + Add Production
          </button>
          <button onClick={() => setStockWorkflow('branch_transfer')}
            className="bg-[#010521] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#162850] transition-colors font-medium">
            ↔ Transfer to Branch
          </button>
          <button onClick={() => setStockWorkflow('distributor_sale')}
            className="bg-[#010521] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#162850] transition-colors font-medium">
            + Sell / Assign to Distributor
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
        {[
          { id: 'on_hand' as const, label: 'Company Stock on Hand', value: `${companyStockSummary.on_hand_units.toLocaleString()} units`, accent: '#0D1B3E', sub: `${companyStockSummary.products_with_stock} products currently stocked` },
          { id: 'available' as const, label: 'Available to Distribute', value: `${companyStockSummary.available_units.toLocaleString()} units`, accent: '#1a7a4a', sub: `${companyStockSummary.reserved_units.toLocaleString()} units reserved` },
          { id: 'cost' as const, label: 'Current Stock Cost Value', value: `₱${companyStockSummary.current_cost_value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, accent: '#9a6f1e', sub: 'On-hand units × current acquisition cost' },
          { id: null, label: 'Total Revenue', value: `₱${adminRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, accent: '#1a7a4a', sub: 'Delivered Admin inventory sales' },
          { id: null, label: 'Stock Assignments', value: adminTotalOrders.toLocaleString(), accent: '#2563eb', sub: 'Admin-issued inventory orders' },
          { id: 'network' as const, label: 'Current Distributor Network Stock', value: `${companyStockSummary.distributed_units.toLocaleString()} units`, accent: '#2563eb', sub: 'Regional, Provincial, City, and Branch only' },
          { id: 'reseller' as const, label: 'Recorded Reseller Purchases', value: `${companyStockSummary.reseller_units.toLocaleString()} units`, accent: '#8b5cf6', sub: 'Excluded from company and distributor stock' },
          {
            id: 'low_stock' as const,
            label: 'Low Stock Alerts',
            value: companyStockSummary.low_stock_products.toLocaleString(),
            accent: companyStockSummary.low_stock_products > 0 ? '#e05252' : '#1a7a4a',
            sub: 'Admin products at or below threshold',
          },
        ].map((s) => (
          <button type="button" key={s.label} disabled={!s.id} onClick={() => s.id && setSelectedStockCard(s.id)} className="rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:hover:translate-y-0"
            style={{ background: `linear-gradient(145deg, rgba(255,255,255,.15), rgba(0,0,0,.14)), ${s.accent}`, borderColor: 'rgba(255,255,255,.3)', boxShadow: `0 8px 20px ${s.accent}38` }}>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/80">{s.label}</p>
            <p className="text-2xl font-extrabold text-white">{s.value}</p>
            {'sub' in s && s.sub && <p className="mt-1 text-[10px] text-white/70">{s.sub}</p>}
            {s.id && <span className="mt-2 block text-[9px] font-semibold text-white/55">View explanation and breakdown →</span>}
          </button>
        ))}
      </div>

      {selectedStockCard && <StockSummaryModal selected={selectedStockCard} summary={companyStockSummary} onClose={() => setSelectedStockCard(null)} />}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        {([
          { key: 'stock',       label: '📦 Product Stock Overview' },
          { key: 'receipts',    label: '🧾 Stock Receipt Ledger' },
          { key: 'distributed', label: '📋 Network & Reseller Records' },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === t.key ? 'bg-[#010521] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PRODUCT STOCK OVERVIEW ── */}
      {tab === 'stock' && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-x-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8 gap-4">
            <div>
              <p className="text-sm font-semibold text-[#0D1B3E]">Product Stock Summary</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Company, network, and reseller records shown separately — <span className="text-[#e05252] font-medium">red = low Admin stock</span>
              </p>
            </div>
            <input
              value={stockSearchInput}
              onChange={(e) => setStockSearchInput(e.target.value)}
              placeholder="Search products..."
              className="bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400 w-60"
            />
          </div>
          <div className="grid min-w-[1300px] grid-cols-11 px-4 py-2 bg-[#F0F2F8]">
            {['Product', 'Cost', 'Regional ₱', 'Provincial ₱', 'City ₱', 'Branch ₱', 'Reseller ₱', 'SRP ₱', 'Admin Stock', 'Network Stock', 'Reseller Purchases'].map((h) => (
              <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
            ))}
          </div>
          {productStock.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">No products found.</p>
          ) : (
            productStock.map((p) => (
              <div key={p.id}
                className={`grid min-w-[1300px] grid-cols-11 px-4 py-3 border-b border-[#0D1B3E]/5 items-center transition-colors ${
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
                <div>
                  <p className="text-xs text-[#8b5cf6]">₱{Number(p.branch_price).toLocaleString()}</p>
                  {Number(p.branch_price) <= 0 && (
                    <p className="text-[9px] text-gray-400">uses cost ₱{Number(p.cost_price).toLocaleString()}</p>
                  )}
                </div>
                <p className="text-xs text-[#C9A84C]">₱{Number(p.reseller_price).toLocaleString()}</p>
                <p className="text-xs text-[#0D1B3E]">₱{Number(p.price).toLocaleString()}</p>
                <div>
                  <p className={`text-sm font-semibold ${
                    p.admin_stock === 0 ? 'text-[#e05252]' : p.admin_stock <= 10 ? 'text-[#9a6f1e]' : 'text-[#1a7a4a]'
                  }`}>
                    {p.admin_stock.toLocaleString()}
                    <span className="text-xs font-normal text-gray-400 ml-1">units</span>
                  </p>
                  <p className="text-[10px] text-gray-400">{p.admin_available.toLocaleString()} available · {p.admin_reserved.toLocaleString()} reserved</p>
                  {p.admin_stock === 0 && <p className="text-[10px] text-[#e05252]">⚠ Manufacture now</p>}
                  {p.admin_stock > 0 && p.admin_stock <= 10 && <p className="text-[10px] text-[#9a6f1e]">⚠ Running low</p>}
                </div>
                <div>
                  <p className={`text-sm font-semibold ${p.total_distributed === 0 ? 'text-gray-300' : 'text-[#0D1B3E]'}`}>
                    {p.total_distributed.toLocaleString()}
                    <span className="text-xs font-normal text-gray-400 ml-1">units</span>
                  </p>
                </div>
                <div>
                  <p className={`text-sm font-semibold ${p.reseller_units === 0 ? 'text-gray-300' : 'text-[#C9A84C]'}`}>
                    {p.reseller_units.toLocaleString()}
                    <span className="text-xs font-normal text-gray-400 ml-1">units</span>
                  </p>
                  <p className="text-[9px] text-gray-400">excluded from stock</p>
                </div>
              </div>
            ))
          )}
          <Pagination meta={stockMeta} onPageChange={setStockPage} />
        </div>
      )}

      {tab === 'receipts' && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
            <p className="text-sm font-semibold text-[#0D1B3E]">Admin Stock Receipt Ledger</p>
            <p className="text-xs text-gray-400 mt-0.5">Append-only proof for every product quantity entering Admin custody.</p>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1.4fr_0.8fr_1fr] px-4 py-2 bg-[#F0F2F8]">
            {['Ledger Ref', 'Source', 'Source Reference', 'Units', 'Received'].map((heading) => (
              <p key={heading} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{heading}</p>
            ))}
          </div>
          {stockReceipts.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">No source-backed stock receipts recorded yet.</p>
          ) : stockReceipts.map((receipt) => (
            <div key={receipt.id} className="grid grid-cols-[1fr_1fr_1.4fr_0.8fr_1fr] px-4 py-3 border-b border-[#0D1B3E]/5 items-center">
              <p className="font-mono text-xs font-semibold text-[#0D1B3E]">{receipt.reference_number}</p>
              <span className="text-xs capitalize text-[#0D1B3E]">{receipt.source_type.replaceAll('_', ' ')}</span>
              <div>
                <p className="text-xs text-[#0D1B3E]">{receipt.source_reference}</p>
                {receipt.notes && <p className="text-[10px] text-gray-400 truncate" title={receipt.notes}>{receipt.notes}</p>}
              </div>
              <div>
                <p className="text-xs font-semibold text-[#1a7a4a]">{receipt.total_units.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400">{receipt.items.length} product(s)</p>
              </div>
              <p className="text-xs text-gray-500">{new Date(receipt.received_at).toLocaleString('en-PH')}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── DISTRIBUTOR INVENTORY ── */}
      {tab === 'distributed' && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-x-auto">
          <div className="border-b border-[#0D1B3E]/8 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
            Regional, Provincial, City, and Branch quantities count as current network stock. Reseller rows are retained only as purchase/assignment audit records and are excluded from company and network stock totals.
          </div>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
              className="bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
              <option value="">All</option>
              {(['regional', 'provincial', 'city', 'reseller'] as const).map((role) => (
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
                  className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${typeFilter === f ? 'bg-[#010521] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Header */}
          <div className="grid min-w-[1380px] grid-cols-[180px_180px_100px_110px_130px_120px_150px_170px_110px] px-4 py-2 bg-[#F0F2F8]">
            {['Distributor', 'Product', 'Current Stock', 'Last Transfer', 'Sale / Value', 'Admin Net', 'Admin Stock', 'Recipient Stock', 'Action'].map((h) => (
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
              const ownerLevel = displayLevel(item.owner)
              const price  = ownerLevel === 'branch'
                ? Number(item.product.branch_price) || Number(item.product.cost_price)
                : ownerLevel === 'regional'
                ? item.product.regional_price
                : ownerLevel === 'provincial'
                ? item.product.provincial_price
                : ownerLevel === 'reseller'
                ? item.product.reseller_price
                : item.product.city_price
              return (
                <div key={item.id}
                  className={`grid min-w-[1380px] grid-cols-[180px_180px_100px_110px_130px_120px_150px_170px_110px] px-4 py-3 border-b border-[#0D1B3E]/5 items-center ${isLow ? 'bg-[#fdecea]/20' : 'hover:bg-[#F0F2F8]/50'}`}>
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">{item.owner.full_name}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${ROLE_COLOR[item.owner.role] || ''}`}>
                      {ownerLevel === 'branch' ? 'Branch' : item.owner.role}
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
                    <p className="text-sm font-semibold text-[#0D1B3E]">
                      {item.movement.quantity == null ? '—' : item.movement.quantity.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-gray-400">{item.movement.is_legacy ? 'Legacy record' : 'latest movement'}</p>
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${item.movement.is_sale ? 'text-[#1a7a4a]' : 'text-gray-400'}`}>
                      ₱{item.movement.sale_value.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {item.movement.is_sale ? `value ₱${item.movement.reference_value.toLocaleString()}` : `No sale · ref ₱${item.movement.reference_value.toLocaleString()}`}
                    </p>
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${item.movement.admin_profit > 0 ? 'text-[#1a7a4a]' : 'text-gray-400'}`}>
                      ₱{item.movement.admin_profit.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-gray-400">{item.movement.is_sale ? 'price − cost' : 'No income'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#0D1B3E]">
                      {item.movement.admin_stock_before == null ? '—' : `${item.movement.admin_stock_before.toLocaleString()} → ${item.movement.admin_stock_after?.toLocaleString()}`}
                    </p>
                    <p className="text-[10px] text-gray-400">before → after</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#0D1B3E]">
                      {item.movement.recipient_stock_before == null ? `— → ${item.quantity.toLocaleString()}` : `${item.movement.recipient_stock_before.toLocaleString()} → ${item.movement.recipient_stock_after.toLocaleString()}`}
                    </p>
                    <p className="text-[10px] text-gray-400">before → after</p>
                  </div>
                  <div>
                    {isEdit ? (
                      <div className="flex items-center gap-1">
                        <input type="number" value={editThreshold} onChange={(e) => setEditThreshold(e.target.value)}
                          className="w-14 bg-[#F0F2F8] border border-[#C9A84C] rounded px-2 py-1 text-xs outline-none" />
                        <button onClick={() => handleSaveThreshold(item.id)} disabled={saving}
                          className="text-xs text-white bg-[#010521] px-2 py-1 rounded disabled:opacity-50">
                          {saving ? '...' : 'Save'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingId(item.id); setEditThreshold(String(item.low_stock_threshold)) }}
                        className="text-xs text-[#C9A84C] hover:underline">
                        Alert: {item.low_stock_threshold}
                      </button>
                    )}
                  </div>
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
      {stockWorkflow && (
        <AssignStockModal
          workflow={stockWorkflow}
          distributors={distributors}
          products={productStock}
          onClose={() => setStockWorkflow(null)}
          onSuccess={() => fetchData()}
        />
      )}
    </div>
  )
}

function StockSummaryModal({ selected, summary, onClose }: {
  selected: 'on_hand' | 'available' | 'cost' | 'network' | 'reseller' | 'low_stock'
  summary: CompanyStockSummary
  onClose: () => void
}) {
  const money = (value: number) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const definitions = {
    on_hand: { title: 'Company Stock on Hand', value: `${summary.on_hand_units.toLocaleString()} units`, explanation: 'Physical products currently recorded in the Admin/Hiroma warehouse. Reserved units remain physically on hand until released or transferred.' },
    available: { title: 'Available to Distribute', value: `${summary.available_units.toLocaleString()} units`, explanation: `Company stock on hand (${summary.on_hand_units}) minus reserved stock (${summary.reserved_units}). This is the quantity currently safe to assign or transfer.` },
    cost: { title: 'Current Stock Cost Value', value: money(summary.current_cost_value), explanation: 'Current company stock on hand multiplied by each product’s current acquisition cost. This is an operational valuation, not sales revenue.' },
    network: { title: 'Current Distributor Network Stock', value: `${summary.distributed_units.toLocaleString()} units`, explanation: 'Current recorded stock held by Regional, Provincial, City, and Branch locations. Reseller-held products are intentionally excluded.' },
    reseller: { title: 'Recorded Reseller Purchases', value: `${summary.reseller_units.toLocaleString()} units`, explanation: 'Products already sold or assigned to resellers. These are outside company and distributor-network stock because resellers may sell them face-to-face to end customers.' },
    low_stock: { title: 'Company Low Stock Alerts', value: summary.low_stock_products.toLocaleString(), explanation: 'Active physical products whose Admin stock is at or below the configured threshold, including products without an Admin inventory balance.' },
  } as const
  const definition = definitions[selected]
  const rows: Array<Array<string | number>> = selected === 'network'
    ? summary.network_breakdown.map(row => [row.level, row.product_name, row.units])
    : selected === 'reseller'
      ? summary.reseller_breakdown.map(row => [row.product_name, row.units])
      : summary.admin_breakdown
          .filter(row => selected !== 'low_stock' || row.on_hand <= row.low_stock_threshold)
          .map(row => selected === 'cost'
            ? [row.product_name, row.on_hand, money(row.current_cost_value)]
            : [row.product_name, row.on_hand, row.reserved, row.available, row.low_stock_threshold])
  const headings = selected === 'network'
    ? ['Distributor level', 'Product', 'Current units']
    : selected === 'reseller'
      ? ['Product', 'Recorded units']
      : selected === 'cost'
        ? ['Product', 'On hand', 'Current cost value']
        : ['Product', 'On hand', 'Reserved', 'Available', 'Low-stock threshold']
  return <div role="dialog" aria-modal="true" aria-labelledby="stock-summary-title" className="fixed inset-0 z-50 flex items-center justify-center bg-[#06102A]/65 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><header className="sticky top-0 z-10 flex items-start justify-between border-b bg-white px-5 py-4"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#C9A84C]">Inventory audit breakdown</p><h2 id="stock-summary-title" className="mt-1 text-lg font-bold text-[#0D1B3E]">{definition.title}: {definition.value}</h2></div><button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm">Close</button></header><div className="space-y-4 p-5"><p className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-gray-600">{definition.explanation}</p><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-slate-50 text-gray-500"><tr>{headings.map(heading => <th key={heading} className="px-3 py-2">{heading}</th>)}</tr></thead><tbody className="divide-y">{rows.map((row,index) => <tr key={index}>{row.map((value,column) => <td key={column} className={`px-3 py-2 ${column === row.length-1 ? 'font-bold text-[#0D1B3E]' : ''}`}>{value}</td>)}</tr>)}{rows.length === 0 && <tr><td colSpan={headings.length} className="px-3 py-8 text-center text-gray-400">No matching inventory records.</td></tr>}</tbody></table></div><p className="text-xs text-gray-400">Read-only explanation. Opening this breakdown does not change inventory quantities or movements.</p></div></section>
  </div>
}
