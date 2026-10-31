'use client'

import { useEffect, useId, useRef, useState } from 'react'
import PasswordInput from '@/app/components/ui/PasswordInput'
import { readSettingsResponse } from '@/app/lib/settingsResponse'

type ClaimScan = {
  member: { id: string; member_id: string; full_name: string; username: string }
  products: { product_id: string; product_name: string; unclaimed: number; available_stock: number }[]
  pin_ready: boolean; scan_proof: string; expires_at: string
}
type Receipt = { reference: string; quantity: number; product_id: string; product_name: string; outlet_name: string; cashier_name: string; available_stock: number; released_at: string }

export default function PosRewardClaimModal({ terminalId, shiftId, onClose, onReleased }: {
  terminalId: string; shiftId: string; onClose: () => void; onReleased: (productId: string, stockAfter: number) => void
}) {
  const scannerId = `reward-claim-scan-${useId().replace(/:/g, '-')}`
  const [scan, setScan] = useState<ClaimScan | null>(null)
  const [camera, setCamera] = useState(false)
  const [code, setCode] = useState('')
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [requestStarted, setRequestStarted] = useState(false)
  const [expired, setExpired] = useState(false)
  const requestId = useRef('')
  const detectionLocked = useRef(false)
  const selected = scan?.products.find(product => product.product_id === productId)
  const limit = selected ? Math.min(100, selected.unclaimed, selected.available_stock) : 0
  const validQuantity = Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= limit

  async function verifyCode(value: string) {
    let memberId = ''
    try { memberId = decodeURIComponent(value).toUpperCase().match(/HRM-\d{4}-\d{6}/)?.[0] || '' } catch { /* Invalid QR content. */ }
    if (!memberId) { setError('Scan a valid Hiroma Member ID QR.'); return false }
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/city/pos/product-reward-claims/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, terminal_id: terminalId, shift_id: shiftId }),
      })
      const payload = await readSettingsResponse<ClaimScan>(response, 'Unable to verify Member ID.')
      setScan(payload); setExpired(false); setProductId(payload.products[0]?.product_id || ''); setQuantity('1'); setPin('')
      requestId.current = crypto.randomUUID(); setCamera(false)
      return true
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to verify Member ID.'); return false }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (!scan) return
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, new Date(scan.expires_at).getTime() - Date.now()))
    return () => window.clearTimeout(timer)
  }, [scan])

  useEffect(() => {
    if (!camera) return
    let disposed = false
    let scanner: import('html5-qrcode').Html5Qrcode | null = null
    detectionLocked.current = false
    void (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (disposed) return
        scanner = new Html5Qrcode(scannerId)
        await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, async decoded => {
          if (detectionLocked.current || disposed) return
          detectionLocked.current = true
          if (!await verifyCode(decoded)) detectionLocked.current = false
        }, () => undefined)
        if (disposed && scanner.isScanning) await scanner.stop()
      } catch { if (!disposed) setError('Camera unavailable. Scan the Member ID with a USB scanner into the field below, or allow camera access.') }
    })()
    return () => {
      disposed = true
      if (scanner?.isScanning) void scanner.stop().then(() => scanner?.clear()).catch(() => undefined)
      else { try { scanner?.clear() } catch { /* Camera startup may still be finishing. */ } }
    }
    // verifyCode uses only this terminal/shift and stable state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, scannerId, terminalId, shiftId])

  async function release() {
    if (busy || !scan || !selected || !validQuantity || pin.length !== 6 || !scan.pin_ready || (!requestStarted && expired)) return
    setBusy(true); setError(''); setRequestStarted(true)
    try {
      const response = await fetch('/api/city/pos/product-reward-claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_request_id: requestId.current, terminal_id: terminalId, shift_id: shiftId,
          reseller_id: scan.member.id, product_id: productId, quantity: Number(quantity), scan_proof: scan.scan_proof, security_pin: pin }),
      })
      if (!response.ok && [400, 401, 403, 409, 429].includes(response.status)) setRequestStarted(false)
      const payload = await readSettingsResponse<{ receipt: Receipt }>(response, 'Unable to confirm release. Retry with the same reference.')
      setReceipt(payload.receipt); setPin(''); onReleased(payload.receipt.product_id, payload.receipt.available_stock)
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to complete release.') }
    finally { setBusy(false) }
  }

  return <div role="dialog" aria-modal="true" aria-labelledby="reward-claim-title" className="fixed inset-0 z-[95] flex items-center justify-center bg-[#010521]/70 p-4">
    <section className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 text-[#071638] shadow-xl">
      <header className="flex items-start justify-between gap-4"><div><h2 id="reward-claim-title" className="text-xl font-bold">Claim Product Rewards</h2><p className="mt-1 text-sm text-gray-500">Bottle release only · no sale or payment</p></div><button type="button" disabled={busy || (requestStarted && !receipt)} onClick={onClose} aria-label="Close claiming" className="rounded-lg border px-3 py-1 disabled:opacity-40">✕</button></header>
      {receipt ? <div className="mt-5 space-y-3">
        <p role="status" className="rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-800">Released {receipt.quantity} × {receipt.product_name}</p>
        <p className="text-sm">Outlet: {receipt.outlet_name}<br />Cashier: {receipt.cashier_name}<br />Date: {new Date(receipt.released_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>
        <code className="block select-all break-all rounded-lg bg-slate-100 p-3 text-xs">{receipt.reference}</code>
        <p className="text-xs text-gray-500">Inventory and reward balance have been updated. This is a product-claim acknowledgment, not a sales receipt.</p>
        <button type="button" onClick={onClose} className="rounded-lg bg-[#071638] px-4 py-2 text-sm text-white">Done</button>
      </div> : <div className="mt-5 space-y-4">
        {!scan ? <>
          <button type="button" disabled={busy} onClick={() => { setError(''); setCamera(value => !value) }} className="rounded-lg bg-[#071638] px-4 py-2 text-sm font-semibold text-white">{camera ? 'Stop camera' : 'Scan Member ID'}</button>
          {camera && <div id={scannerId} className="min-h-72 rounded-lg border bg-slate-950" />}
          <form onSubmit={event => { event.preventDefault(); if (!busy) void verifyCode(code) }} className="flex gap-2">
            <label className="sr-only" htmlFor="claim-qr-content">Member ID scanner input</label><input id="claim-qr-content" value={code} onChange={event => setCode(event.target.value)} disabled={busy} placeholder="USB scanner / Member ID" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" /><button type="submit" disabled={busy || !code} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Verify</button>
          </form>
        </> : <>
          <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{scan.member.full_name}</strong><p>{scan.member.member_id} · @{scan.member.username}</p></div>
          {!scan.products.length ? <p className="text-sm text-gray-500">No unclaimed reward bottles.</p> : <>
            <label className="block text-xs text-gray-500">Reward product<select value={productId} disabled={busy || requestStarted} onChange={event => { setProductId(event.target.value); setQuantity('1') }} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">{scan.products.map(product => <option key={product.product_id} value={product.product_id}>{product.product_name} · {product.unclaimed} unclaimed · {product.available_stock} outlet stock</option>)}</select></label>
            <label className="block text-xs text-gray-500">Bottles to release<input type="number" min={1} max={limit} step={1} value={quantity} disabled={busy || requestStarted || limit < 1} onChange={event => setQuantity(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
            {limit < 1 && <p className="text-sm text-amber-700">This outlet has no available stock for the selected reward bottle.</p>}
            <label className="block text-xs text-gray-500">Reseller Security PIN<PasswordInput type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} disabled={busy || !scan.pin_ready} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Reseller enters their own PIN" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
            {!scan.pin_ready && <p className="text-sm text-amber-700">The reseller must configure their Security PIN before claiming.</p>}
            {expired && !requestStarted && <p className="text-sm text-amber-700">Scan verification expired. Scan the Member ID again.</p>}
            <p className="text-xs text-gray-500">Confirm only when handing over these bottles. One confirmed release deducts outlet stock and marks the reward units claimed together.</p>
            <button type="button" onClick={() => void release()} disabled={busy || !validQuantity || pin.length !== 6 || !scan.pin_ready || (expired && !requestStarted)} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Confirming…' : requestStarted ? 'Retry same release' : 'Confirm release'}</button>
          </>}
          {!requestStarted && <button type="button" disabled={busy} onClick={() => { setScan(null); setPin(''); setError('') }} className="block text-xs text-gray-500 underline">Scan another Member ID</button>}
        </>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {requestStarted && <p className="text-xs text-amber-700">If the connection fails, retry this same release. Do not hand out bottles twice or start a new claim while the result is uncertain.</p>}
      </div>}
    </section>
  </div>
}
