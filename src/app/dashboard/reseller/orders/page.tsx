'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'
import OrderConversation from '@/app/components/orders/OrderConversation'
import OrderPaymentPanel from '@/app/components/orders/OrderPaymentPanel'

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
  payment_method:    string | null
  payment_reference: string | null
  payment_status:    string | null
  payment_method_id: string | null
  payment_due_at: string | null
  payment_destination_snapshot: { type?: string; account_name?: string; account_number?: string; bank_name?: string | null } | null
  cancelled_at: string | null
  cancelled_by_actor_id: string | null
  cancelled_by_name: string | null
  cancelled_by_role: string | null
  cancellation_reason: string | null
  fulfillment_method?: string
  pickup_scheduled_at?: string | null
  pickup_schedule_timezone?: string | null
  shipping_status?: string | null
  shipping_fee?: number
  seller: { full_name: string; username: string; role: string }
  items: OrderItem[]
}

interface Supplier {
  id: string
  full_name: string
  username: string
}

interface Product {
  id: string
  name: string
  type: string
  price: number
  available_quantity: number
}

interface CityDist {
  id: string
  full_name: string
  username: string
  mobile?: string
  address?: string | null
  fulfillment_address?: string | null
  fulfillment_location_source?: 'physical_outlet' | 'registered_address'
  fulfillment_outlet_name?: string | null
  distributor_profile: { coverage_area: string; dist_level?: string; region_name?: string | null; province_name?: string | null; city_muni_name?: string | null; barangay_name?: string | null } | null
}

interface PaymentMethodInfo {
  id:             string
  type:           string
  account_name:   string
  account_number: string
  bank_name:      string | null
}

interface CartItem {
  product: Product
  quantity: number
}

interface Place { code: string; name: string }

interface DeliveryLocation {
  region_code: string; region_name: string
  province_code: string; province_name: string
  city_muni_code: string; city_muni_name: string
  barangay_code: string; barangay_name: string
  street: string; zip_code: string
}

const PAGE_SIZE = 15

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-[#fef9ee] text-[#9a6f1e]',
  processing: 'bg-[#eef0f8] text-[#0D1B3E]',
  ready_for_pickup: 'bg-[#f0f7ff] text-[#2563eb]',
  delivered:  'bg-[#e8f7ef] text-[#1a7a4a]',
  cancelled:  'bg-[#fdecea] text-[#a03030]',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Order Placed',
  processing: 'Processing',
  ready_for_pickup: 'Ready for Pickup',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

const PAYMENT_LABEL: Record<string, string> = {
  cash_on_pickup: '💵 Cash on Pickup',
  payment_after_shipping_quote: '🚚 Payment after shipping quote',
  gcash:          '📱 GCash',
  bank_transfer:  '🏦 Bank Transfer',
}

// ============================================================
// CREATE ORDER MODAL
// ============================================================

function CreateOrderModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [assignedDist, setAssignedDist]   = useState<CityDist | null>(null)
  const [selectedDistId, setSelectedDistId] = useState('')
  const [recommendedDist, setRecommendedDist] = useState<CityDist | null>(null)
  const [nationwideSeller, setNationwideSeller] = useState<CityDist | null>(null)
  const [fulfillmentMethod, setFulfillmentMethod] = useState<'partner_pickup' | 'nationwide_delivery'>('partner_pickup')
  const [recommendationBasis, setRecommendationBasis] = useState('assigned_fallback')
  const [pickupDistanceKm, setPickupDistanceKm] = useState<number | null>(null)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [registeredAddress, setRegisteredAddress] = useState('')
  const [addressSource, setAddressSource] = useState<'registered' | 'manual'>('registered')
  const [step, setStep] = useState<'address' | 'order'>('address')
  const [regions, setRegions] = useState<Place[]>([])
  const [provinces, setProvinces] = useState<Place[]>([])
  const [cityMunis, setCityMunis] = useState<Place[]>([])
  const [barangays, setBarangays] = useState<Place[]>([])
  const [loadingProv, setLoadingProv] = useState(false)
  const [loadingCity, setLoadingCity] = useState(false)
  const [loadingBarangay, setLoadingBarangay] = useState(false)
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocation>({
    region_code: '', region_name: '', province_code: '', province_name: '',
    city_muni_code: '', city_muni_name: '', barangay_code: '', barangay_name: '', street: '', zip_code: '',
  })
  const [distSearch, setDistSearch]       = useState('')
  const [showDistDrop, setShowDistDrop]   = useState(false)
  const [products, setProducts]           = useState<Product[]>([])
  const [loadingDists, setLoadingDists]   = useState(true)
  const [cart, setCart]                   = useState<CartItem[]>([])
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({})
  const [notes, setNotes]                 = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [error, setError]                 = useState('')
  const [search, setSearch]               = useState('')
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [paymentMethodId, setPaymentMethodId] = useState('cash_on_pickup')
  const [acceptsCash, setAcceptsCash] = useState(false)
  const [pickupScheduledAt, setPickupScheduledAt] = useState('')
  const [paymentMethods, setPaymentMethods]   = useState<PaymentMethodInfo[]>([])
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null)
  const recommendationRequestId = useRef(0)
  // The chosen fulfillment method is the source of truth. This prevents a late
  // pickup-recommendation response from changing a nationwide order's seller.
  const fulfillmentSellerId = fulfillmentMethod === 'nationwide_delivery'
    ? nationwideSeller?.id || ''
    : recommendedDist?.id || selectedDistId

  const loadFulfillmentRecommendation = useCallback((address?: string, location?: DeliveryLocation) => {
    const requestId = ++recommendationRequestId.current
    const params = new URLSearchParams()
    if (address?.trim()) params.set('address', address.trim())
    if (location?.region_name) params.set('region', location.region_name)
    if (location?.province_name) params.set('province', location.province_name)
    if (location?.city_muni_name) params.set('city', location.city_muni_name)
    if (location?.barangay_name) params.set('barangay', location.barangay_name)
    const query = params.size ? `?${params}` : ''
    return fetch(`/api/reseller/city-distributors${query}`, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Unable to load fulfillment locations.')
        return data
      })
      .then((d) => {
        if (requestId !== recommendationRequestId.current) return
        const assigned = d.assigned_distributor || d.distributors?.[0] || null
        setAssignedDist(assigned)
        setRegisteredAddress(d.registered_address || '')
        const recommended = d.recommended_distributor || assigned
        setNationwideSeller(d.nationwide_seller || null)
        setRecommendedDist(recommended)
        setRecommendationBasis(d.recommendation_basis || 'assigned_fallback')
        setPickupDistanceKm(typeof d.distance_km === 'number' ? d.distance_km : null)
        if (recommended?.id) setSelectedDistId(recommended.id)
        else setError(d.error || 'No active distributor is assigned to your account.')
      })
      .catch((requestError: unknown) => {
        if (requestId !== recommendationRequestId.current) return
        setNationwideSeller(null)
        setPickupDistanceKm(null)
        setError(requestError instanceof Error ? requestError.message : 'Unable to load fulfillment locations.')
      })
      .finally(() => {
        if (requestId === recommendationRequestId.current) setLoadingDists(false)
      })
  }, [])

  useEffect(() => { void loadFulfillmentRecommendation() }, [loadFulfillmentRecommendation])

  // Keep the registered-address choice available even if the fulfillment lookup
  // is temporarily unavailable or an older reseller profile lacks its relation.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((response) => response.json())
      .then((data) => {
        const address = data?.user?.address?.trim()
        if (address) setRegisteredAddress((current) => current || address)
      })
      .catch(() => undefined)
  }, [])

  // "Use registered address" is the default choice, so populate it as soon as
  // the account profile finishes loading. A manual delivery address is never overwritten.
  useEffect(() => {
    if (addressSource === 'registered' && !deliveryAddress && registeredAddress) {
      setDeliveryAddress(registeredAddress)
    }
  }, [addressSource, deliveryAddress, registeredAddress])

  useEffect(() => {
    fetch('https://psgc.gitlab.io/api/regions/')
      .then((response) => response.json())
      .then((data) => setRegions(Array.isArray(data) ? data.map((item: Place) => ({ code: item.code, name: item.name })).sort((a: Place, b: Place) => a.name.localeCompare(b.name)) : []))
      .catch(() => setRegions([]))
  }, [])

  useEffect(() => {
    if (!deliveryLocation.region_code) { setProvinces([]); setCityMunis([]); return }
    setLoadingProv(true)
    setDeliveryLocation((current) => ({ ...current, province_code: '', province_name: '', city_muni_code: '', city_muni_name: '', barangay_code: '', barangay_name: '' }))
    setCityMunis([]); setBarangays([])
    fetch(`https://psgc.gitlab.io/api/regions/${deliveryLocation.region_code}/provinces/`)
      .then((response) => response.json())
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) {
          setProvinces([]); setLoadingCity(true)
          return fetch(`https://psgc.gitlab.io/api/regions/${deliveryLocation.region_code}/cities-municipalities/`)
            .then((response) => response.json())
            .then((cities) => {
              setCityMunis(Array.isArray(cities) ? cities.map((item: Place) => ({ code: item.code, name: item.name })).sort((a: Place, b: Place) => a.name.localeCompare(b.name)) : [])
              setDeliveryLocation((current) => ({ ...current, province_code: 'DIRECT', province_name: '' }))
            })
            .finally(() => setLoadingCity(false))
        }
        setProvinces(data.map((item: Place) => ({ code: item.code, name: item.name })).sort((a: Place, b: Place) => a.name.localeCompare(b.name)))
      })
      .catch(() => setProvinces([]))
      .finally(() => setLoadingProv(false))
  }, [deliveryLocation.region_code])

  useEffect(() => {
    if (!deliveryLocation.province_code || deliveryLocation.province_code === 'DIRECT') {
      if (deliveryLocation.province_code !== 'DIRECT') setCityMunis([])
      return
    }
    setLoadingCity(true); setBarangays([])
    setDeliveryLocation((current) => ({ ...current, city_muni_code: '', city_muni_name: '', barangay_code: '', barangay_name: '' }))
    fetch(`https://psgc.gitlab.io/api/provinces/${deliveryLocation.province_code}/cities-municipalities/`)
      .then((response) => response.json())
      .then((data) => setCityMunis(Array.isArray(data) ? data.map((item: Place) => ({ code: item.code, name: item.name })).sort((a: Place, b: Place) => a.name.localeCompare(b.name)) : []))
      .catch(() => setCityMunis([]))
      .finally(() => setLoadingCity(false))
  }, [deliveryLocation.province_code])

  useEffect(() => {
    if (!deliveryLocation.city_muni_code) { setBarangays([]); return }
    setLoadingBarangay(true)
    setDeliveryLocation((current) => ({ ...current, barangay_code: '', barangay_name: '' }))
    fetch(`https://psgc.gitlab.io/api/cities-municipalities/${deliveryLocation.city_muni_code}/barangays/`)
      .then((response) => response.json())
      .then((data) => setBarangays(Array.isArray(data) ? data.map((item: Place) => ({ code: item.code, name: item.name })).sort((a: Place, b: Place) => a.name.localeCompare(b.name)) : []))
      .catch(() => setBarangays([]))
      .finally(() => setLoadingBarangay(false))
  }, [deliveryLocation.city_muni_code])

  useEffect(() => {
    if (addressSource !== 'manual') return
    const formatted = [deliveryLocation.street, deliveryLocation.barangay_name, deliveryLocation.city_muni_name, deliveryLocation.province_name, deliveryLocation.region_name, deliveryLocation.zip_code].filter(Boolean).join(', ')
    setDeliveryAddress(formatted)
  }, [addressSource, deliveryLocation])

  // Refresh the fulfillment recommendation as the delivery address changes.
  // A short delay prevents a request on every keystroke in the street field.
  useEffect(() => {
    if (fulfillmentMethod !== 'partner_pickup') return
    const canRecommend = addressSource === 'registered'
      ? Boolean(deliveryAddress.trim())
      : Boolean(deliveryLocation.city_muni_code)
    if (!canRecommend) {
      recommendationRequestId.current += 1
      setLoadingDists(false)
      setRecommendedDist(null)
      setSelectedDistId('')
      return
    }
    const timer = window.setTimeout(() => {
      setLoadingDists(true)
      void loadFulfillmentRecommendation(
        deliveryAddress,
        addressSource === 'manual' ? deliveryLocation : undefined,
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [addressSource, deliveryAddress, deliveryLocation, fulfillmentMethod, loadFulfillmentRecommendation])

  useEffect(() => {
    if (!fulfillmentSellerId) { setProducts([]); setLoadingProducts(false); setPaymentMethods([]); setAcceptsCash(false); return }
    setLoadingProducts(true)
    // Fetch products and payment methods in parallel
    Promise.all([
      fetch(`/api/reseller/products?seller_id=${fulfillmentSellerId}`).then((r) => r.json()),
      fetch(`/api/payment-methods?${new URLSearchParams({
        user_id: fulfillmentSellerId,
        status: 'approved',
        delivery_address: deliveryAddress,
        region: deliveryLocation.region_name,
        province: deliveryLocation.province_name,
        city: deliveryLocation.city_muni_name,
        barangay: deliveryLocation.barangay_name,
      })}`).then((r) => r.json()),
    ]).then(([prodData, pmData]) => {
      setProducts(prodData.products || [])
      setPaymentMethods(pmData.methods || [])
      setAcceptsCash(Boolean(pmData.accepts_cash_on_pickup))
      setPaymentMethodId(pmData.accepts_cash_on_pickup ? 'cash_on_pickup' : (pmData.methods?.[0]?.id || ''))
    }).finally(() => setLoadingProducts(false))
    setCart([])
    setPaymentMethodId(fulfillmentMethod === 'nationwide_delivery' ? 'payment_after_shipping_quote' : '')
  }, [fulfillmentSellerId, fulfillmentMethod, deliveryAddress, deliveryLocation.region_name, deliveryLocation.province_name, deliveryLocation.city_muni_name, deliveryLocation.barangay_name])

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id)
      if (existing) {
        if (existing.quantity >= product.available_quantity) return prev
        return prev.map((c) =>
          c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c
        )
      }
      return [...prev, { product, quantity: 1 }]
    })
  }

  const updateQty = (productId: string, qty: number) => {
    const product = products.find((p) => p.id === productId)
    if (qty <= 0) setCart((prev) => prev.filter((c) => c.product.id !== productId))
    else if (product && qty <= product.available_quantity) {
      setCart((prev) => prev.map((c) => c.product.id === productId ? { ...c, quantity: qty } : c))
    }
  }

  const total = cart.reduce((s, c) => s + c.product.price * c.quantity, 0)
  const cityDists = assignedDist ? [assignedDist] : []

  const proceedToOrder = async () => {
    if (addressSource === 'manual') {
      const hasProvince = deliveryLocation.province_code === 'DIRECT' || Boolean(deliveryLocation.province_code)
      if (!deliveryLocation.region_code || !hasProvince || !deliveryLocation.city_muni_code || !deliveryLocation.barangay_code || !deliveryLocation.street.trim() || !/^\d{4}$/.test(deliveryLocation.zip_code)) {
        setError('Complete the region, province, city/municipality, barangay, street, and 4-digit ZIP code.'); return
      }
    }
    if (!deliveryAddress.trim()) { setError('Enter the delivery address before proceeding.'); return }
    setError('')
    if (fulfillmentMethod === 'partner_pickup') {
      setLoadingDists(true)
      await loadFulfillmentRecommendation(deliveryAddress, addressSource === 'manual' ? deliveryLocation : undefined)
    } else if (!nationwideSeller) {
      setError('Hiroma Main is temporarily unavailable for door-to-door delivery.'); return
    }
    setStep('order')
  }

  const changeQuantityDraft = (productId: string, value: string) => {
    const digits = value.replace(/\D/g, '')
    setError('')
    setQuantityDrafts((current) => ({ ...current, [productId]: digits }))
    if (digits === '') return
    const quantity = Number(digits)
    const product = products.find((item) => item.id === productId)
    if (Number.isInteger(quantity) && quantity >= 1 && product && quantity <= product.available_quantity) {
      updateQty(productId, quantity)
    }
  }

  const commitQuantityDraft = (productId: string) => {
    setQuantityDrafts((current) => {
      const draft = current[productId]
      const product = products.find((item) => item.id === productId)
      const quantity = Number(draft)
      if (draft === '' || !product || !Number.isInteger(quantity) || quantity < 1 || quantity > product.available_quantity) return current
      const next = { ...current }
      delete next[productId]
      return next
    })
  }

  const clearQuantityDraft = (productId: string) => {
    setQuantityDrafts((current) => {
      const next = { ...current }
      delete next[productId]
      return next
    })
  }

  const quantityErrors = cart.reduce<Record<string, string>>((errors, item) => {
    const draft = quantityDrafts[item.product.id]
    if (draft === undefined) return errors
    if (draft === '') errors[item.product.id] = 'Enter a quantity.'
    else if (!Number.isInteger(Number(draft)) || Number(draft) < 1) errors[item.product.id] = 'Quantity must be at least 1.'
    else if (Number(draft) > item.product.available_quantity) errors[item.product.id] = `Only ${item.product.available_quantity} unit(s) are available from this supplier.`
    return errors
  }, {})
  const hasQuantityErrors = Object.keys(quantityErrors).length > 0

  const recommendationLabel: Record<string, string> = {
    exact_barangay: 'Exact barangay coverage',
    exact_city: 'Exact city/municipality coverage',
    exact_province: 'Province coverage',
    same_region: 'Regional fallback',
    address_keywords: 'Closest available address match',
    assigned_fallback: 'Assigned distributor fallback',
  }

  const handleSubmit = async () => {
    if (!fulfillmentSellerId) { setError('No active fulfillment location is available.'); return }
    if (cart.length === 0) { setError('Add at least one item.'); return }
    if (hasQuantityErrors) { setError('Correct the highlighted quantity before placing the order.'); return }
    if (fulfillmentMethod === 'partner_pickup' && !pickupScheduledAt) {
      setError('Select your preferred pickup date and time.')
      return
    }
    if (fulfillmentMethod === 'partner_pickup' && !paymentMethodId) { setError('This outlet has no payment method available.'); return }
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/reseller/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        city_dist_id:     fulfillmentSellerId,
        fulfillment_method: fulfillmentMethod,
        delivery_address: deliveryAddress.trim(),
        delivery_location: {
          region: deliveryLocation.region_name,
          province: deliveryLocation.province_name,
          city: deliveryLocation.city_muni_name,
          barangay: deliveryLocation.barangay_name,
        },
        notes,
        payment_method_id: paymentMethodId,
        pickup_scheduled_at: fulfillmentMethod === 'partner_pickup' ? pickupScheduledAt : null,
        items: cart.map((c) => ({
          product_id: c.product.id,
          quantity:   c.quantity,
          unit_price: c.product.price,
        })),
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) setCreatedOrder(data.order)
    else setError(data.error || 'Something went wrong.')
  }

  if (createdOrder) {
    const destination = createdOrder.payment_destination_snapshot
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><h2 className="text-lg font-bold text-[#0D1B3E]">Order placed</h2><p className="mt-1 text-xs text-gray-500">{createdOrder.order_number || `Order #${createdOrder.id.slice(0, 8)}`}</p>{destination ? <div className="mt-5 rounded-xl border border-[#C9A84C]/30 bg-[#fef9ee] p-4"><p className="text-xs font-bold text-[#0D1B3E]">Pay to this verified account</p><p className="mt-2 text-sm font-semibold">{destination.bank_name || (destination.type === 'gcash' ? 'GCash' : 'Bank Transfer')}</p><p className="text-sm">{destination.account_name}</p><p className="font-mono text-base font-bold">{destination.account_number}</p><p className="mt-3 text-xs text-[#a03030]">Pay the exact ₱{Number(createdOrder.total_amount).toLocaleString()} and upload proof before {createdOrder.payment_due_at ? new Date(createdOrder.payment_due_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : 'the deadline'}.</p></div> : <p className="mt-5 rounded-xl bg-[#e8f7ef] p-4 text-sm text-[#1a7a4a]">Cash on Pickup selected. No advance payment proof is required.</p>}<button onClick={() => { onSuccess(); onClose() }} className="mt-5 w-full rounded-xl bg-[#010521] py-3 text-sm font-semibold text-white">View my orders</button></div></div>
  }

  if (step === 'address') {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between">
            <div><h2 className="text-sm font-semibold text-[#0D1B3E]">How would you like to receive your order?</h2><p className="text-xs text-gray-500 mt-0.5">Choose fulfillment first, then confirm the address.</p></div>
            <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">×</button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button type="button" onClick={() => { setFulfillmentMethod('partner_pickup'); setSelectedDistId(recommendedDist?.id || ''); setPaymentMethodId(''); setError('') }} className={`text-left rounded-xl border-2 p-4 transition-colors ${fulfillmentMethod === 'partner_pickup' ? 'border-[#C9A84C] bg-[#fef9ee]' : 'border-[#0D1B3E]/10 hover:border-[#0D1B3E]/25'}`}>
                <span className="block text-sm font-semibold text-[#0D1B3E]">📍 Partner Pickup</span>
                <span className="block text-xs leading-5 text-gray-600 mt-1">Pick up from the nearest available Hiroma partner or branch. No courier shipping fee.</span>
              </button>
              <button type="button" onClick={() => { setFulfillmentMethod('nationwide_delivery'); setSelectedDistId(nationwideSeller?.id || ''); setPaymentMethodId('payment_after_shipping_quote'); setError('') }} className={`text-left rounded-xl border-2 p-4 transition-colors ${fulfillmentMethod === 'nationwide_delivery' ? 'border-[#C9A84C] bg-[#fef9ee]' : 'border-[#0D1B3E]/10 hover:border-[#0D1B3E]/25'}`}>
                <span className="block text-sm font-semibold text-[#0D1B3E]">🚚 Door-to-Door Delivery</span>
                <span className="block text-xs leading-5 text-gray-600 mt-1">Hiroma Main processes and ships the order. Shipping is quoted before payment.</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setDeliveryAddress(registeredAddress); setAddressSource('registered') }} disabled={!registeredAddress}
                className={`text-xs px-3 py-2 rounded-lg border transition-colors ${addressSource === 'registered' ? 'border-[#C9A84C] bg-[#fef9ee] text-[#0D1B3E]' : 'border-[#0D1B3E]/15 text-gray-500'} disabled:opacity-40`}>Use registered address</button>
              <button onClick={() => { setDeliveryAddress(''); setAddressSource('manual'); setRecommendedDist(null); setSelectedDistId(''); setError('') }} className={`text-xs px-3 py-2 rounded-lg border transition-colors ${addressSource === 'manual' ? 'border-[#C9A84C] bg-[#fef9ee] text-[#0D1B3E]' : 'border-[#0D1B3E]/15 text-gray-500'}`}>Enter different address</button>
            </div>
            {!registeredAddress && <p className="text-xs text-amber-700 bg-[#fef9ee] rounded-lg px-3 py-2">No registered address is available. Please enter the delivery address.</p>}
            {addressSource === 'manual' ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Select the exact delivery location. All fields are required.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="block text-xs text-gray-500 mb-1">Region <span className="text-[#a03030]">*</span></label><select value={deliveryLocation.region_code} onChange={(e) => { const item = regions.find((region) => region.code === e.target.value); setDeliveryLocation((current) => ({ ...current, region_code: e.target.value, region_name: item?.name || '' })) }} className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"><option value="">Select region...</option>{regions.map((region) => <option key={region.code} value={region.code}>{region.name}</option>)}</select></div>
                  {provinces.length > 0 && <div><label className="block text-xs text-gray-500 mb-1">Province <span className="text-[#a03030]">*</span></label><select value={deliveryLocation.province_code} disabled={!deliveryLocation.region_code || loadingProv} onChange={(e) => { const item = provinces.find((province) => province.code === e.target.value); setDeliveryLocation((current) => ({ ...current, province_code: e.target.value, province_name: item?.name || '' })) }} className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50"><option value="">{loadingProv ? 'Loading...' : 'Select province...'}</option>{provinces.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}</select></div>}
                  <div><label className="block text-xs text-gray-500 mb-1">City / Municipality <span className="text-[#a03030]">*</span></label><select value={deliveryLocation.city_muni_code} disabled={!deliveryLocation.province_code || loadingCity} onChange={(e) => { const item = cityMunis.find((city) => city.code === e.target.value); setDeliveryLocation((current) => ({ ...current, city_muni_code: e.target.value, city_muni_name: item?.name || '' })) }} className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50"><option value="">{loadingCity ? 'Loading...' : 'Select city/municipality...'}</option>{cityMunis.map((city) => <option key={city.code} value={city.code}>{city.name}</option>)}</select></div>
                  <div><label className="block text-xs text-gray-500 mb-1">Barangay <span className="text-[#a03030]">*</span></label><select value={deliveryLocation.barangay_code} disabled={!deliveryLocation.city_muni_code || loadingBarangay} onChange={(e) => { const item = barangays.find((barangay) => barangay.code === e.target.value); setDeliveryLocation((current) => ({ ...current, barangay_code: e.target.value, barangay_name: item?.name || '' })) }} className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50"><option value="">{loadingBarangay ? 'Loading...' : 'Select barangay...'}</option>{barangays.map((barangay) => <option key={barangay.code} value={barangay.code}>{barangay.name}</option>)}</select></div>
                  <div><label className="block text-xs text-gray-500 mb-1">Street / house no. <span className="text-[#a03030]">*</span></label><input value={deliveryLocation.street} onChange={(e) => setDeliveryLocation((current) => ({ ...current, street: e.target.value }))} placeholder="e.g. Rizal Street, House 12" className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">ZIP code <span className="text-[#a03030]">*</span></label><input value={deliveryLocation.zip_code} inputMode="numeric" maxLength={4} onChange={(e) => setDeliveryLocation((current) => ({ ...current, zip_code: e.target.value.replace(/\D/g, '').slice(0, 4) }))} placeholder="e.g. 6606" className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]" /></div>
                </div>
                {deliveryAddress && <div className="rounded-lg bg-[#e8f7ef] border border-[#1a7a4a]/30 px-3 py-2"><p className="text-[10px] text-gray-400">{fulfillmentMethod === 'partner_pickup' ? 'Address used to find a nearby pickup partner' : 'Shipping address preview'}</p><p className="text-xs text-[#1a7a4a] font-medium mt-0.5">{deliveryAddress}</p></div>}
              </div>
            ) : (
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">{fulfillmentMethod === 'partner_pickup' ? 'Address for pickup recommendation' : 'Delivery address'} <span className="text-[#a03030]">*</span></label>
                <div className="relative">
                  <textarea
                    value={deliveryAddress}
                    readOnly
                    rows={3}
                    aria-readonly="true"
                    placeholder="No registered address available"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 pr-10 text-sm text-[#0D1B3E] outline-none resize-none cursor-not-allowed select-text"
                  />
                  <span className="absolute right-3 top-2.5 text-sm" aria-hidden="true">🔒</span>
                </div>
                <p className="text-[11px] leading-4 text-gray-500 mt-1.5">This is your registered account address and cannot be edited here. Choose “Enter different address” to use another location.</p>
              </div>
            )}
            {((addressSource === 'registered' && deliveryAddress.trim()) || (addressSource === 'manual' && deliveryLocation.city_muni_code)) && <div className="rounded-xl border border-[#C9A84C]/40 bg-[#fef9ee] px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-[#9a6f1e] font-semibold">{fulfillmentMethod === 'partner_pickup' ? 'Recommended Hiroma partner / branch' : 'Door-to-door fulfillment'}</p>
              {fulfillmentMethod === 'nationwide_delivery' ? (nationwideSeller ? <><p className="text-sm font-semibold text-[#0D1B3E] mt-1">Hiroma Main</p><p className="text-xs text-gray-600 mt-1">Your order goes directly to Hiroma Main. The courier and shipping fee will remain pending until an official quote is recorded.</p></> : <p className="text-xs text-[#a03030] mt-1">Hiroma Main is temporarily unavailable.</p>) : loadingDists ? <p className="text-xs text-gray-400 mt-1">Finding a nearby partner…</p> : recommendedDist ? <><p className="text-sm font-semibold text-[#0D1B3E] mt-1">{recommendedDist.full_name}</p><p className="text-xs text-gray-500">@{recommendedDist.username}{recommendedDist.distributor_profile?.coverage_area ? ` · ${recommendedDist.distributor_profile.coverage_area}` : ''}</p><p className="text-[11px] text-[#9a6f1e] mt-1.5">{recommendationLabel[recommendationBasis] || 'Available pickup partner'}</p>{pickupDistanceKm !== null && <p className="text-[11px] font-medium text-[#0D1B3E] mt-1">Approximately {pickupDistanceKm.toLocaleString(undefined, { maximumFractionDigits: 1 })} km from this address <span className="font-normal text-gray-500">(straight-line)</span></p>}<p className="text-[11px] text-gray-500 mt-1">Final stock is checked again before the order is placed.</p></> : <p className="text-xs text-[#a03030] mt-1">No active Hiroma partner or branch is available.</p>}
            </div>}
            {error && <p className="text-xs text-[#a03030]">{error}</p>}
          </div>
          <div className="px-5 py-4 border-t border-[#0D1B3E]/8 flex gap-2 justify-end">
            <button onClick={onClose} className="text-xs px-4 py-2 rounded-lg bg-[#F0F2F8] text-[#0D1B3E]">Cancel</button>
            <button onClick={proceedToOrder} disabled={(fulfillmentMethod === 'partner_pickup' && loadingDists) || !deliveryAddress.trim()} className="text-xs px-4 py-2 rounded-lg bg-[#C9A84C] text-white font-medium disabled:opacity-50">Proceed to products</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[94dvh] sm:max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Place New Order</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {fulfillmentMethod === 'nationwide_delivery' ? 'Door-to-Door Delivery · Fulfilled by Hiroma Main' : recommendedDist ? `Partner Pickup · ${recommendedDist.full_name}` : 'No pickup partner available'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-1 min-h-0 flex-col md:flex-row overflow-y-auto md:overflow-hidden">

          {/* Left — product picker */}
          <div className="flex-1 flex flex-col border-b md:border-b-0 md:border-r border-[#0D1B3E]/8 min-w-0 md:min-h-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0 space-y-2">

              <div className="flex items-start justify-between gap-3 rounded-lg bg-[#fef9ee] border border-[#C9A84C]/30 px-3 py-2">
                <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-[#9a6f1e]">{fulfillmentMethod === 'partner_pickup' ? 'Pickup recommendation address' : 'Shipping address'}</p><p className="text-xs text-[#0D1B3E] truncate mt-0.5">{deliveryAddress}</p></div>
                <button onClick={() => setStep('address')} className="text-[11px] text-[#9a6f1e] hover:underline flex-shrink-0">Change</button>
              </div>

              {/* Fulfillment distributor is selected from the delivery address; it is not the referral sponsor. */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">{fulfillmentMethod === 'partner_pickup' ? 'Hiroma pickup partner / branch' : 'Door-to-door fulfillment center'}</label>
                {loadingDists ? (
                  <div className="h-[58px] rounded-xl bg-[#F0F2F8] animate-pulse" />
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={(fulfillmentMethod === 'nationwide_delivery' ? 'Hiroma Main' : recommendedDist?.full_name) || ''}
                      readOnly
                      onChange={(e) => {
                        setDistSearch(e.target.value)
                        setShowDistDrop(true)
                        if (!e.target.value) setSelectedDistId('')
                      }}
                      onFocus={() => setShowDistDrop(true)}
                      onBlur={() => setTimeout(() => setShowDistDrop(false), 150)}
                      placeholder="Search city distributor..."
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400"
                    />
                    {false && fulfillmentSellerId && (
                      <button onClick={() => { setSelectedDistId(''); setDistSearch('') }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#0D1B3E] text-xs">✕</button>
                    )}
                    {false && showDistDrop && (
                      <div className="absolute z-[100] w-full bg-white border border-[#0D1B3E]/15 rounded-xl shadow-xl mt-1 max-h-40 overflow-y-auto">
                        {cityDists
                          .filter((d) =>
                            !distSearch ||
                            d.full_name.toLowerCase().includes(distSearch.toLowerCase()) ||
                            d.username.toLowerCase().includes(distSearch.toLowerCase())
                          )
                          .map((d) => (
                            <div key={d.id}
                              onMouseDown={() => {
                                setSelectedDistId(d.id)
                                setDistSearch('')
                                setShowDistDrop(false)
                              }}
                              className={`px-3 py-2.5 cursor-pointer hover:bg-[#F0F2F8] transition-colors ${fulfillmentSellerId === d.id ? 'bg-[#F0F2F8]' : ''}`}>
                              <p className="text-xs font-medium text-[#0D1B3E]">{d.full_name}</p>
                              <p className="text-[10px] text-gray-400">@{d.username}{d.distributor_profile?.coverage_area ? ` · ${d.distributor_profile.coverage_area}` : ''}</p>
                            </div>
                          ))
                        }
                        {cityDists.filter((d) =>
                          !distSearch ||
                          d.full_name.toLowerCase().includes(distSearch.toLowerCase()) ||
                          d.username.toLowerCase().includes(distSearch.toLowerCase())
                        ).length === 0 && (
                          <p className="text-xs text-gray-400 px-3 py-3 text-center">No distributor found</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {fulfillmentMethod === 'partner_pickup' && recommendedDist && (
                <div className="rounded-lg border border-[#0D1B3E]/10 bg-[#F0F2F8]/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Fulfillment Contact Information</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-[#0D1B3E]/10 text-[#0D1B3E]">
                      {recommendedDist.distributor_profile?.dist_level === 'branch' ? 'Hiroma Branch' : 'Hiroma Partner'}
                    </span>
                  </div>
                  {recommendedDist.fulfillment_location_source === 'physical_outlet' && (
                    <p className="text-[10px] text-[#1a7a4a] mt-1">Physical outlet{recommendedDist.fulfillment_outlet_name ? ` · ${recommendedDist.fulfillment_outlet_name}` : ''}</p>
                  )}
                  <p className="text-xs font-medium text-[#0D1B3E] mt-1">{recommendedDist.fulfillment_address || recommendedDist.address || recommendedDist.distributor_profile?.coverage_area || 'Address not available'}</p>
                  {pickupDistanceKm !== null && <p className="text-[11px] text-gray-500 mt-1">Approx. {pickupDistanceKm.toLocaleString(undefined, { maximumFractionDigits: 1 })} km from your selected address (straight-line)</p>}
                  {recommendedDist.mobile ? (
                    <a href={`tel:${recommendedDist.mobile}`} className="inline-flex items-center gap-1 text-xs text-[#9a6f1e] hover:underline mt-1.5">
                      <span aria-hidden="true">☎</span> {recommendedDist.mobile}
                    </a>
                  ) : <p className="text-xs text-gray-400 mt-1.5">Contact number not available</p>}
                </div>
              )}

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                disabled={!fulfillmentSellerId}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400 disabled:opacity-50"
              />
            </div>

            <div className="flex-1 overflow-y-auto min-h-36 md:min-h-0 max-h-72 md:max-h-none">
              {loadingProducts ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-8">
                  {!fulfillmentSellerId
                    ? 'Select a Hiroma fulfillment location to see available products.'
                    : products.length === 0
                    ? 'No products are currently in stock at this fulfillment location.'
                    : 'No products found.'}
                </p>
              ) : (
                filtered.map((product) => {
                  const inCart = cart.find((c) => c.product.id === product.id)
                  return (
                    <div key={product.id}
                      className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors">
                      <div>
                        <p className="text-xs font-medium text-[#0D1B3E]">{product.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            product.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'
                          }`}>{product.type}</span>
                          <span className="text-xs text-gray-400">₱{Number(product.price).toLocaleString()}</span>
                          <span className="text-xs text-gray-300">· {product.available_quantity} in stock</span>
                        </div>
                      </div>
                      <button
                        onClick={() => addToCart(product)}
                        disabled={inCart ? inCart.quantity >= product.available_quantity : false}
                        className="text-xs bg-[#0D1B3E] text-white px-3 py-1.5 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-40">
                        + Add
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right — cart + payment */}
          <div className="w-full md:w-72 flex flex-col flex-shrink-0 md:min-h-0">
            <div className="px-4 py-3 border-b border-[#0D1B3E]/8 flex-shrink-0">
              <p className="text-xs font-semibold text-[#0D1B3E]">Order Summary</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 min-h-24 max-h-56 md:max-h-none">
              {cart.length === 0 ? (
                <p className="text-xs text-gray-400 text-center pt-4">No items yet</p>
              ) : (
                cart.map((c) => (
                  <div key={c.product.id} className="text-xs">
                    <p className="font-medium text-[#0D1B3E] truncate">{c.product.name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <button onClick={() => { clearQuantityDraft(c.product.id); updateQty(c.product.id, c.quantity - 1) }}
                        className="w-5 h-5 bg-[#F0F2F8] rounded text-[#0D1B3E] font-bold flex items-center justify-center flex-shrink-0">−</button>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={quantityDrafts[c.product.id] ?? String(c.quantity)}
                        onChange={(e) => changeQuantityDraft(c.product.id, e.target.value)}
                        onBlur={() => commitQuantityDraft(c.product.id)}
                        onFocus={(e) => e.currentTarget.select()}
                        aria-label={`Quantity for ${c.product.name}`}
                        aria-invalid={Boolean(quantityErrors[c.product.id])}
                        className={`w-10 text-center text-xs text-[#0D1B3E] bg-[#F0F2F8] rounded border outline-none py-0.5 ${quantityErrors[c.product.id] ? 'border-[#C23B3B] focus:border-[#C23B3B]' : 'border-[#0D1B3E]/15 focus:border-[#C9A84C]'}`} />
                      <button onClick={() => { clearQuantityDraft(c.product.id); updateQty(c.product.id, c.quantity + 1) }}
                        disabled={c.quantity >= c.product.available_quantity}
                        className="w-5 h-5 bg-[#F0F2F8] rounded text-[#0D1B3E] font-bold flex items-center justify-center flex-shrink-0 disabled:opacity-40">+</button>
                      <span className="ml-auto text-gray-400">₱{(c.product.price * c.quantity).toLocaleString()}</span>
                    </div>
                    {quantityErrors[c.product.id] && <p className="mt-1.5 text-[10px] leading-4 text-[#C23B3B]" role="alert">{quantityErrors[c.product.id]}</p>}
                  </div>
                ))
              )}
            </div>

            <div className="px-4 py-3 border-t border-[#0D1B3E]/8 flex-shrink-0 space-y-3">
              <div className="flex justify-between text-xs font-semibold text-[#0D1B3E]">
                <span>Total</span>
                <span>₱{total.toLocaleString()}</span>
              </div>

              <div className="rounded-lg bg-[#eef4ff] border border-[#2563eb]/20 px-3 py-2">
                <p className="text-xs font-medium text-[#0D1B3E]">Online order</p>
                <p className="text-[11px] leading-4 text-gray-600 mt-0.5">The system records reseller-account orders as online automatically.</p>
              </div>

              {/* Payment method */}
              {fulfillmentMethod === 'partner_pickup' && (
                <div>
                  <label className="mb-1 block text-xs text-gray-500">Preferred pickup date and time <span className="text-[#a03030]">*</span></label>
                  <input type="datetime-local" value={pickupScheduledAt} onChange={(event) => { setPickupScheduledAt(event.target.value); setError('') }} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-2.5 py-2 text-xs text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
                  <p className="mt-1 text-[10px] leading-4 text-gray-500">Philippine time · at least 15 minutes from now · up to 30 days ahead. Reserved units cannot be sold to walk-in customers.</p>
                </div>
              )}

              <div className={fulfillmentMethod === 'nationwide_delivery' ? 'hidden' : ''}>
                <p className="text-xs text-gray-400 mb-1.5">Payment Method</p>
                <div className="space-y-1.5">
                  {acceptsCash && <div onClick={() => setPaymentMethodId('cash_on_pickup')}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border-2 cursor-pointer transition-colors ${
                      paymentMethodId === 'cash_on_pickup' ? 'border-[#C9A84C] bg-[#fef9ee]' : 'border-[#0D1B3E]/10 hover:border-[#0D1B3E]/20'
                    }`}>
                    <span className="text-sm">💵</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-[#0D1B3E]">Cash on Pickup</p>
                    </div>
                    {paymentMethodId === 'cash_on_pickup' && <span className="text-[#C9A84C] text-xs">✓</span>}
                  </div>}
                  {/* Approved payment methods */}
                  {paymentMethods.map((pm) => (
                    <div key={pm.id} onClick={() => setPaymentMethodId(pm.id)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border-2 cursor-pointer transition-colors ${
                        paymentMethodId === pm.id ? 'border-[#C9A84C] bg-[#fef9ee]' : 'border-[#0D1B3E]/10 hover:border-[#0D1B3E]/20'
                      }`}>
                      <span className="text-sm">{pm.type === 'gcash' ? '📱' : '🏦'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium text-[#0D1B3E]">{pm.type === 'gcash' ? 'GCash' : 'Bank Transfer'}</p>
                        {pm.bank_name && <p className="text-[9px] text-gray-400 truncate">{pm.bank_name}</p>}
                        <p className="text-[9px] text-gray-400 truncate">{pm.account_name} · {pm.account_number}</p>
                      </div>
                      {paymentMethodId === pm.id && <span className="text-[#C9A84C] text-xs flex-shrink-0">✓</span>}
                    </div>
                  ))}
                </div>
                {paymentMethodId && paymentMethodId !== 'cash_on_pickup' && <p className="mt-2 rounded-lg bg-[#fef9ee] px-3 py-2 text-[10px] leading-4 text-[#7a5717]">Place the order first. You will then receive the exact verified account and up to 48 hours (or before pickup, whichever comes first) to pay and upload proof.</p>}
              </div>

              {fulfillmentMethod === 'nationwide_delivery' && (
                <div className="rounded-lg border border-[#C9A84C]/40 bg-[#fef9ee] px-3 py-2.5">
                  <p className="text-xs font-semibold text-[#0D1B3E]">Payment after shipping quote</p>
                  <p className="text-[11px] leading-4 text-gray-600 mt-1">Product total is shown now, but it is not the final payable amount. Hiroma Main must record the official courier fee first.</p>
                </div>
              )}

              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Message to City/Branch (optional)" aria-label="Initial message to City or Branch" rows={2}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-xs text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400 resize-none" />

              {error && <p className="text-xs text-[#a03030]">{error}</p>}

              <button onClick={handleSubmit} disabled={submitting || cart.length === 0 || hasQuantityErrors || (fulfillmentMethod === 'partner_pickup' && !pickupScheduledAt)}
                className="w-full bg-[#C9A84C] text-white text-xs py-2 rounded-lg hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium">
                {submitting ? 'Placing...' : 'Place Order'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function ResellerOrdersPage() {
  const [orders, setOrders]     = useState<Order[]>([])
  const [meta, setMeta]         = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]   = useState(true)
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter]     = useState('all')
  const [page, setPage]                 = useState(1)
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [cancelling, setCancelling]     = useState<string | null>(null)
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null)
  const [showCreate, setShowCreate]     = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

  const [summary, setSummary] = useState({
    total: 0, pending: 0, processing: 0, ready_for_pickup: 0, delivered: 0, cancelled: 0,
  })

  useEffect(() => { setPage(1) }, [statusFilter, typeFilter])

  const fetchOrders = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      status: statusFilter, type: typeFilter,
      page: String(page), pageSize: String(PAGE_SIZE),
    })
    fetch(`/api/reseller/orders?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setOrders(data.orders || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.summary)  setSummary(data.summary)
        if (data.supplier) setSupplier(data.supplier)
      })
      .finally(() => setLoading(false))
  }, [statusFilter, typeFilter, page])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  useEffect(() => {
    const openCheckoutFromHash = () => {
      if (window.location.hash !== '#place-order') return
      setShowCreate(true)
      window.history.replaceState(null, '', window.location.pathname)
    }
    openCheckoutFromHash()
    window.addEventListener('hashchange', openCheckoutFromHash)
    return () => window.removeEventListener('hashchange', openCheckoutFromHash)
  }, [])

  const handleCancel = async (orderId: string) => {
    setCancelling(orderId)
    await fetch('/api/reseller/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    })
    setCancelling(null)
    fetchOrders()
  }

  return (
    <div className="max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Shop &amp; My Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Place a pickup or door-to-door delivery order, then track it here.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="bg-[#C9A84C] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#b8963e] transition-colors font-medium">
          + Place New Order
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        {[
          { label: 'Total',            value: summary.total,            accent: '#0D1B3E' },
          { label: 'Pending',          value: summary.pending,          accent: '#A17820' },
          { label: 'Processing',       value: summary.processing,       accent: '#475569' },
          { label: 'Ready for Pickup', value: summary.ready_for_pickup, accent: '#2563EB' },
          { label: 'Delivered',        value: summary.delivered,        accent: '#168052' },
          { label: 'Cancelled',        value: summary.cancelled,        accent: '#C23B3B' },
        ].map((s) => (
          <div key={s.label} className="orderSummaryCard group relative min-h-24 overflow-hidden rounded-xl border p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
            style={{ background: `linear-gradient(145deg, rgba(255,255,255,.18), rgba(0,0,0,.16)), ${s.accent}`, borderColor: 'rgba(255,255,255,.3)', borderTop: '3px solid rgba(255,255,255,.62)', boxShadow: `0 10px 26px ${s.accent}38` }}>
            <div aria-hidden="true" className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/20 blur-2xl transition-transform group-hover:scale-125" />
            <div className="relative"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/80">{s.label}</p><p className="text-2xl font-extrabold text-white">{s.value}</p></div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <div className="flex gap-1 flex-wrap">
            {(['all', 'pending', 'processing', 'ready_for_pickup', 'delivered', 'cancelled'] as const).map((f) => (
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
          {['Supplier', 'Payment', 'Amount', 'Status', 'Actions'].map((h) => (
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
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No orders yet.</p>
            <p className="text-gray-300 text-xs mt-1">Click &quot;+ New Order&quot; to place your first order.</p>
          </div>
        ) : (
          orders.map((order) => (
            <div key={order.id}>
              <div
                className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center cursor-pointer"
                onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
              >
                {/* Seller */}
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{order.seller.full_name}</p>
                  <p className="text-xs text-gray-400">@{order.seller.username}</p>
                  <p className="text-[10px] text-gray-300">{new Date(order.created_at).toLocaleDateString('en-PH')}</p>
                </div>

                {/* Payment */}
                <div>
                  <p className="text-[10px] text-gray-500">{PAYMENT_LABEL[order.payment_method || 'cash_on_pickup'] || order.payment_method}</p>
                  {order.payment_reference && (
                    <p className="text-[10px] text-gray-400">Ref: {order.payment_reference}</p>
                  )}
                  {order.payment_status === 'paid' ? (
                    <span className="text-[10px] text-[#1a7a4a] font-medium">✓ Paid</span>
                  ) : order.payment_method !== 'cash_on_pickup' ? (
                    <span className="text-[10px] text-[#9a6f1e]">⏳ Unpaid</span>
                  ) : null}
                </div>

                {/* Amount */}
                <div>
                  <p className="text-xs font-semibold text-[#0D1B3E]">₱{Number(order.total_amount).toLocaleString()}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    order.order_type === 'online' ? 'bg-[#f0f7ff] text-[#2563eb]' : 'bg-[#eef0f8] text-[#0D1B3E]'
                  }`}>{order.order_type}</span>
                </div>

                {/* Status */}
                <span className={`text-xs px-2 py-0.5 rounded-full w-fit ${STATUS_COLORS[order.status]}`}>
                  {STATUS_LABELS[order.status] || order.status}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>

                  {/* View details */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedOrder(order) }}
                    className="w-7 h-7 rounded-lg bg-[#eef0f8] hover:bg-[#C9A84C] flex items-center justify-center transition-colors group flex-shrink-0"
                    title="View details">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>

                  {/* Cancel */}
                  {order.status === 'pending' && (
                    <button disabled={cancelling === order.id} onClick={() => setCancelConfirm(order.id)}
                      className="w-7 h-7 rounded-lg bg-[#fdecea] hover:bg-[#a03030] flex items-center justify-center transition-colors group flex-shrink-0 disabled:opacity-50"
                      title="Cancel order">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#a03030] group-hover:text-white">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded items */}
              {expandedId === order.id && (
                <div className="orderExpandedItems px-6 py-3 bg-[#F8F9FC] border-b border-[#0D1B3E]/5">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Order Items</p>
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
                  {order.notes && <p className="text-xs text-gray-400 mt-2 italic">Note: {order.notes}</p>}
                </div>
              )}
            </div>
          ))
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Create Order Modal */}
      {showCreate && (
        <CreateOrderModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); fetchOrders() }}
        />
      )}

      {/* Order Details Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={() => setSelectedOrder(null)}>
          <div className="orderDetailsModal bg-[#F7F8FC] rounded-[24px] shadow-2xl border border-white/20 w-full max-w-2xl max-h-[92vh] overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}>
            <div className="relative overflow-hidden px-6 py-5 bg-[#010521] flex items-start justify-between">
              <div className="absolute -right-10 -top-14 w-40 h-40 rounded-full bg-[#C9A84C]/15 blur-xl" />
              <div className="relative">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A84C] font-semibold mb-1">Order overview</p>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-white tracking-tight">
                    Order {selectedOrder.order_number || `#${selectedOrder.id.slice(0, 8).toUpperCase()}`}
                  </h2>
                  <span className="text-[10px] px-2.5 py-1 rounded-full capitalize bg-white/10 text-white border border-white/10">
                    {selectedOrder.status}
                  </span>
                </div>
                <p className="text-xs text-white/50 mt-1">
                  Placed on {new Date(selectedOrder.created_at).toLocaleString('en-PH')}
                </p>
                {selectedOrder.pickup_scheduled_at && <p className="mt-1 text-xs font-medium text-[#E8C96A]">Pickup: {new Date(selectedOrder.pickup_scheduled_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}</p>}
              </div>
              <button onClick={() => setSelectedOrder(null)}
                className="relative w-9 h-9 rounded-xl bg-white/10 text-white/60 hover:text-white hover:bg-white/20 text-lg transition-colors">
                ×
              </button>
            </div>

            <div className="overflow-y-auto max-h-[calc(92vh-88px)] p-5 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-2xl bg-white border border-[#0D1B3E]/8 p-4 shadow-sm">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Supplier</p>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-xl bg-[#eef0f8] flex items-center justify-center">🏪</span>
                    <p className="text-sm font-semibold text-[#0D1B3E]">{selectedOrder.seller.full_name}</p>
                  </div>
                  <p className="text-xs text-gray-400">@{selectedOrder.seller.username}</p>
                </div>
                <div className="rounded-2xl bg-white border border-[#0D1B3E]/8 p-4 shadow-sm">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Payment</p>
                  <p className="text-sm font-medium text-[#0D1B3E]">
                    {PAYMENT_LABEL[selectedOrder.payment_method || 'cash_on_pickup'] || selectedOrder.payment_method}
                  </p>
                  <p className={`text-xs mt-1 ${selectedOrder.payment_status === 'paid' ? 'text-[#1a7a4a]' : 'text-[#9a6f1e]'}`}>
                    {selectedOrder.payment_status === 'paid' ? '✓ Paid' : 'Pending payment'}
                  </p>
                  {selectedOrder.payment_reference && (
                    <p className="text-xs text-gray-400 mt-1">Reference: {selectedOrder.payment_reference}</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-[#0D1B3E]/8 overflow-hidden shadow-sm">
                <div className="bg-white px-4 py-3 border-b border-[#0D1B3E]/6 flex items-center justify-between">
                  <p className="text-xs font-semibold text-[#0D1B3E]">Order Items</p>
                  <span className="text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-1 rounded-full">
                    {selectedOrder.items.reduce((sum, item) => sum + item.quantity, 0)} units
                  </span>
                </div>
                {selectedOrder.items.map((item, index) => (
                  <div key={`${item.product.name}-${index}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F8F9FC] transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-xl bg-[#F0F2F8] flex items-center justify-center">📦</span>
                      <div>
                      <p className="text-xs font-medium text-[#0D1B3E]">{item.product.name}</p>
                      <p className="text-[10px] text-gray-400">
                        ₱{Number(item.unit_price).toLocaleString()} × {item.quantity}
                      </p>
                      </div>
                    </div>
                    <p className="text-xs font-semibold text-[#0D1B3E]">
                      ₱{Number(item.subtotal).toLocaleString()}
                    </p>
                  </div>
                ))}
                <div className="flex justify-between items-center px-4 py-4 bg-gradient-to-r from-[#F8F9FC] to-[#fef9ee]">
                  <p className="text-sm font-semibold text-[#0D1B3E]">Total Amount</p>
                  <p className="text-lg font-bold text-[#C9A84C]">
                    ₱{Number(selectedOrder.total_amount).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-[#0D1B3E]/8 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Order journey</p>
                    <p className="text-sm font-semibold text-[#0D1B3E] mt-0.5">
                      {selectedOrder.status === 'cancelled' ? 'Order cancelled' : 'Track your order progress'}
                    </p>
                  </div>
                  <span className="text-xl">{selectedOrder.status === 'delivered' ? '🎉' : selectedOrder.status === 'cancelled' ? '✕' : '🚚'}</span>
                </div>

                {selectedOrder.status === 'cancelled' ? (
                  <div className="rounded-xl bg-[#fdecea] border border-[#e05252]/20 px-4 py-3 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-[#e05252] text-white flex items-center justify-center font-bold">×</span>
                    <div>
                      <p className="text-xs font-semibold text-[#a03030]">{selectedOrder.cancelled_by_role === 'reseller' ? 'Cancelled by you' : selectedOrder.cancelled_by_name ? `Cancelled by ${selectedOrder.cancelled_by_role?.replaceAll('_', ' ') || 'authorized staff'} — ${selectedOrder.cancelled_by_name}` : 'Cancellation attribution unavailable (legacy order)'}</p>
                      {selectedOrder.cancelled_at && <p className="text-[10px] text-[#a03030]/70 mt-0.5">{new Date(selectedOrder.cancelled_at).toLocaleString('en-PH')}</p>}
                      <p className="text-[10px] text-[#a03030]/70 mt-0.5">{selectedOrder.cancellation_reason || 'No cancellation reason recorded.'}</p>
                    </div>
                  </div>
                ) : (
                  <div className="relative grid grid-cols-4">
                    <div className="absolute top-5 left-[12.5%] right-[12.5%] h-1 bg-[#e6e8ef] rounded-full" />
                    <div
                      className="absolute top-5 left-[12.5%] h-1 bg-gradient-to-r from-[#C9A84C] to-[#dfc36f] rounded-full transition-all"
                      style={{
                        width: selectedOrder.status === 'pending'
                          ? '0%'
                          : selectedOrder.status === 'processing'
                            ? '25%'
                            : selectedOrder.status === 'ready_for_pickup'
                              ? '50%'
                              : '75%',
                      }}
                    />
                    {([
                      ['pending', 'Order Placed', '✓'],
                      ['processing', 'Processing', '📦'],
                      ['ready_for_pickup', 'Ready for Pickup', '🏪'],
                      ['delivered', 'Delivered', '✓'],
                    ] as const).map(([step, label, icon]) => {
                      const sequence = ['pending', 'processing', 'ready_for_pickup', 'delivered']
                      const reached = sequence.indexOf(step) <= sequence.indexOf(selectedOrder.status)
                      const current = step === selectedOrder.status
                      return (
                        <div key={step} className="relative z-10 text-center">
                          <div className={`mx-auto w-11 h-11 rounded-full flex items-center justify-center border-4 border-white shadow-sm transition-all ${
                            reached ? 'bg-[#C9A84C] text-white' : 'bg-[#e6e8ef] text-gray-400'
                          } ${current ? 'ring-4 ring-[#C9A84C]/15 scale-110' : ''}`}>
                            <span className="text-sm font-bold">{icon}</span>
                          </div>
                          <p className={`text-xs mt-2 font-semibold ${reached ? 'text-[#0D1B3E]' : 'text-gray-300'}`}>{label}</p>
                          <p className="text-[9px] text-gray-400 mt-0.5">
                            {step === 'pending' ? 'Received' : step === 'processing' ? 'Being prepared' : step === 'ready_for_pickup' ? 'Pay & collect' : 'Completed'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {selectedOrder.notes && (
                <div className="rounded-xl bg-[#fef9ee] border border-[#C9A84C]/30 px-4 py-3">
                  <p className="text-[10px] uppercase text-[#9a6f1e]">Order note</p>
                  <p className="text-xs text-[#7a5717] mt-1">{selectedOrder.notes}</p>
                </div>
              )}

              <OrderPaymentPanel orderId={selectedOrder.id} onChanged={() => void fetchOrders()} />
              <OrderConversation orderId={selectedOrder.id} />

              <button onClick={() => setSelectedOrder(null)}
                className="w-full bg-[#010521] text-white hover:bg-[#0D1B3E] text-sm font-medium py-3 rounded-xl hover:shadow-lg hover:shadow-[#0D1B3E]/15 transition-all">
                Close
              </button>
            </div>
          </div>
        </div>
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
              <button onClick={() => { handleCancel(cancelConfirm); setCancelConfirm(null) }}
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
