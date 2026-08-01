'use client'

interface CityOrderDetails {
  id: string
  order_number: string | null
  status: string
  total_amount: number
  created_at: string
  is_non_member_sale: boolean
  customer_name: string | null
  notes: string | null
  payment_method: string | null
  payment_reference: string | null
  payment_status: string | null
  buyer: { full_name: string; username: string; role: string }
  items: Array<{ quantity: number; unit_price: number; subtotal: number; product: { name: string; type: string } }>
}

const PAYMENT_LABEL: Record<string, string> = {
  cash_on_pickup: 'Cash on Pickup',
  gcash: 'GCash',
  bank_transfer: 'Bank Transfer',
}

export default function CityOrderDetailsModal({ order, onClose }: { order: CityOrderDetails; onClose: () => void }) {
  const counterparty = order.is_non_member_sale ? { full_name: order.customer_name || 'Walk-in Customer', username: 'non-member' } : order.buyer
  const steps = [['pending', 'Order Placed', 'Received'], ['processing', 'Processing', 'Being prepared'], ['ready_for_pickup', 'Ready for Pickup', 'Pay and collect'], ['delivered', 'Delivered', 'Completed']] as const
  const currentIndex = steps.findIndex(([status]) => status === order.status)

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="city-order-modal-title" onMouseDown={onClose}>
    <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-[24px] border border-white/20 bg-[#F7F8FC] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <header className="relative flex items-start justify-between overflow-hidden bg-[#010521] px-6 py-5">
        <div className="absolute -right-10 -top-14 h-40 w-40 rounded-full bg-[#C9A84C]/15 blur-xl" />
        <div className="relative"><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#C9A84C]">Order overview</p><div className="flex flex-wrap items-center gap-2"><h2 id="city-order-modal-title" className="text-lg font-semibold text-white">Order {order.order_number || `#${order.id.slice(0, 8).toUpperCase()}`}</h2><span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] capitalize text-white">{order.status === 'ready_for_pickup' ? 'Ready for Pickup' : order.status}</span></div><p className="mt-1 text-xs text-white/50">Placed on {new Date(order.created_at).toLocaleString('en-PH')}</p></div>
        <button type="button" aria-label="Close order details" onClick={onClose} className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-xl text-white/60 hover:bg-white/20 hover:text-white">Ã—</button>
      </header>
      <div className="max-h-[calc(92vh-88px)] space-y-4 overflow-y-auto p-5">
        <div className="grid gap-4 md:grid-cols-2"><section className="rounded-2xl border border-[#0D1B3E]/8 bg-white p-4 shadow-sm"><p className="mb-2 text-[10px] uppercase tracking-wide text-gray-400">Buyer</p><p className="text-sm font-semibold text-[#0D1B3E]">{counterparty.full_name}</p><p className="text-xs text-gray-400">@{counterparty.username}</p></section><section className="rounded-2xl border border-[#0D1B3E]/8 bg-white p-4 shadow-sm"><p className="mb-2 text-[10px] uppercase tracking-wide text-gray-400">Payment</p><p className="text-sm font-medium text-[#0D1B3E]">{PAYMENT_LABEL[order.payment_method || 'cash_on_pickup'] || order.payment_method || 'Not specified'}</p><p className={`mt-1 text-xs ${order.payment_status === 'paid' ? 'text-[#1a7a4a]' : 'text-[#9a6f1e]'}`}>{order.payment_status === 'paid' ? 'âœ“ Paid' : 'Pending payment'}</p>{order.payment_reference && <p className="mt-1 text-xs text-gray-400">Reference: {order.payment_reference}</p>}</section></div>
        <section className="overflow-hidden rounded-2xl border border-[#0D1B3E]/8 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-[#0D1B3E]/6 px-4 py-3"><p className="text-xs font-semibold text-[#0D1B3E]">Order Items</p><span className="rounded-full bg-[#eef0f8] px-2 py-1 text-[10px] text-[#0D1B3E]">{order.items.reduce((total, item) => total + item.quantity, 0)} units</span></div>{order.items.map((item, index) => <div key={`${item.product.name}-${index}`} className="flex items-center justify-between gap-3 border-b border-[#0D1B3E]/5 px-4 py-3"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F0F2F8]">ðŸ“¦</span><div><p className="text-xs font-medium text-[#0D1B3E]">{item.product.name}</p><p className="text-[10px] text-gray-400">â‚±{Number(item.unit_price).toLocaleString()} Ã— {item.quantity}</p></div></div><p className="text-xs font-semibold text-[#0D1B3E]">â‚±{Number(item.subtotal).toLocaleString()}</p></div>)}<div className="flex items-center justify-between bg-gradient-to-r from-[#F8F9FC] to-[#fef9ee] px-4 py-4"><p className="text-sm font-semibold text-[#0D1B3E]">Total Amount</p><p className="text-lg font-bold text-[#C9A84C]">â‚±{Number(order.total_amount).toLocaleString()}</p></div></section>
        <section className="rounded-2xl border border-[#0D1B3E]/8 bg-white p-5 shadow-sm"><p className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Order journey</p><p className="mt-0.5 text-sm font-semibold text-[#0D1B3E]">{order.status === 'cancelled' ? 'Order cancelled' : 'Track order progress'}</p>{order.status === 'cancelled' ? <div className="mt-4 rounded-xl border border-[#e05252]/20 bg-[#fdecea] px-4 py-3 text-xs font-semibold text-[#a03030]">This order was cancelled.</div> : <div className="relative mt-5 grid grid-cols-4 gap-1"><div className="absolute left-[12.5%] right-[12.5%] top-5 h-1 rounded-full bg-[#e6e8ef]" />{steps.map(([status, label, description], index) => { const reached = index <= currentIndex; const current = index === currentIndex; return <div key={status} className="relative z-10 text-center"><div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full border-4 border-white text-sm font-bold shadow-sm ${reached ? 'bg-[#C9A84C] text-white' : 'bg-[#e6e8ef] text-gray-400'} ${current ? 'ring-4 ring-[#C9A84C]/15' : ''}`}>{reached ? 'âœ“' : index + 1}</div><p className={`mt-2 text-[10px] font-semibold sm:text-xs ${reached ? 'text-[#0D1B3E]' : 'text-gray-300'}`}>{label}</p><p className="mt-0.5 hidden text-[9px] text-gray-400 sm:block">{description}</p></div> })}</div>}</section>
        {order.notes && <section className="rounded-xl border border-[#C9A84C]/30 bg-[#fef9ee] px-4 py-3"><p className="text-[10px] uppercase text-[#9a6f1e]">Order note</p><p className="mt-1 text-xs text-[#7a5717]">{order.notes}</p></section>}
        <button type="button" onClick={onClose} className="w-full rounded-xl bg-[#010521] py-3 text-sm font-medium text-white hover:bg-[#0D1B3E]">Close</button>
      </div>
    </div>
  </div>
}