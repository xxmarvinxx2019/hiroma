'use client'

import { useCallback, useEffect, useState } from 'react'

type Destination = { type?: string; account_name?: string; account_number?: string; bank_name?: string | null }
type Evidence = { id: string; sender_name: string; reference_number: string; amount: number; paid_at: string; status: string; rejection_reason?: string | null; proof_url?: string | null; created_at: string }
type PaymentData = { payment_method: string | null; payment_status: string | null; payment_due_at: string | null; payment_destination: Destination | null; total_amount: number; is_buyer: boolean; evidence: Evidence[] }

export default function OrderPaymentPanel({ orderId, onChanged }: { orderId: string; onChanged?: () => void }) {
  const [data, setData] = useState<PaymentData | null>(null)
  const [form, setForm] = useState({ sender_name: '', reference_number: '', amount: '', paid_at: '', proof_data_url: '' })
  const [proofName, setProofName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => fetch(`/api/orders/${orderId}/payment`, { cache: 'no-store' }).then(async (response) => ({ response, body: await response.json() })).then(({ response, body }) => { if (response.ok) { setData(body); setForm((current) => ({ ...current, amount: String(Number(body.total_amount)) })) } }), [orderId])
  useEffect(() => { void load() }, [load])
  if (!data || !['gcash', 'bank_transfer'].includes(data.payment_method || '')) return null
  const destination = data.payment_destination || {}
  const submitted = data.evidence.find((item) => item.status === 'submitted')
  const deadline = data.payment_due_at ? new Date(data.payment_due_at) : null
  const submitProof = async () => {
    setBusy(true); setError('')
    const response = await fetch(`/api/orders/${orderId}/payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, paid_at: new Date(form.paid_at).toISOString() }) })
    const body = await response.json(); setBusy(false)
    if (!response.ok) setError(body.error || 'Unable to submit proof.')
    else { await load(); onChanged?.() }
  }
  const review = async (action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? window.prompt('Reason for rejecting this proof:')?.trim() : ''
    if (action === 'reject' && !reason) return
    setBusy(true); setError('')
    const response = await fetch(`/api/orders/${orderId}/payment`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, rejection_reason: reason }) })
    const body = await response.json(); setBusy(false)
    if (!response.ok) setError(body.error || 'Unable to review proof.')
    else { await load(); onChanged?.() }
  }
  return <section className="rounded-2xl border border-[#C9A84C]/30 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#9a6f1e]">Electronic payment</p><p className="mt-1 text-sm font-bold text-[#0D1B3E]">{destination.bank_name || (destination.type === 'gcash' ? 'GCash' : 'Bank Transfer')}</p><p className="text-xs text-gray-600">{destination.account_name}</p><p className="font-mono text-sm font-semibold text-[#0D1B3E]">{destination.account_number}</p></div><span className="rounded-full bg-[#fef9ee] px-3 py-1 text-[10px] font-semibold capitalize text-[#9a6f1e]">{data.payment_status?.replaceAll('_', ' ')}</span></div>
    {deadline && <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-xs text-[#a03030]">Payment deadline: {deadline.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}. Unpaid orders are cancelled automatically and stock is released.</p>}
    {data.is_buyer && ['awaiting_payment', 'payment_rejected'].includes(data.payment_status || '') && <div className="mt-4 grid gap-2 sm:grid-cols-2"><input value={form.sender_name} onChange={(e) => setForm({ ...form, sender_name: e.target.value })} placeholder="Sender/account name" className="rounded-lg border p-2 text-xs"/><input value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} placeholder="Transaction reference" className="rounded-lg border p-2 text-xs"/><input type="number" value={form.amount} readOnly className="rounded-lg border bg-gray-50 p-2 text-xs"/><input type="datetime-local" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} className="rounded-lg border p-2 text-xs"/><label className="sm:col-span-2 rounded-lg border border-dashed p-3 text-center text-xs text-gray-500"><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; setProofName(file.name); const reader = new FileReader(); reader.onload = () => setForm((current) => ({ ...current, proof_data_url: String(reader.result || '') })); reader.readAsDataURL(file) }}/>{proofName || 'Choose payment screenshot (max 5 MB)'}</label><button disabled={busy || !form.proof_data_url || !form.paid_at} onClick={submitProof} className="sm:col-span-2 rounded-lg bg-[#C9A84C] py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Submitting...' : 'Submit proof for verification'}</button></div>}
    {data.is_buyer && data.payment_status === 'verification_pending' && <p className="mt-3 rounded-lg bg-[#eef4ff] p-3 text-xs text-[#2563eb]">Proof submitted. The outlet must verify it before preparing the order.</p>}
    {!data.is_buyer && submitted && <div className="mt-4 rounded-xl border bg-[#F7F8FC] p-3 text-xs"><p><b>Sender:</b> {submitted.sender_name}</p><p><b>Reference:</b> {submitted.reference_number}</p><p><b>Amount:</b> ₱{Number(submitted.amount).toLocaleString()}</p><p><b>Transaction time:</b> {new Date(submitted.paid_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>{submitted.proof_url && <a href={submitted.proof_url} target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold text-[#2563eb] underline">Open payment proof</a>}<div className="mt-3 flex gap-2"><button disabled={busy} onClick={() => review('approve')} className="flex-1 rounded-lg bg-[#1a7a4a] py-2 font-semibold text-white">Verify payment</button><button disabled={busy} onClick={() => review('reject')} className="flex-1 rounded-lg bg-[#a03030] py-2 font-semibold text-white">Reject proof</button></div></div>}
    {data.evidence.filter((item) => item.status !== 'submitted').length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold text-gray-600">Payment review history</summary><div className="mt-2 space-y-2">{data.evidence.filter((item) => item.status !== 'submitted').map((item) => <div key={item.id} className="rounded-lg bg-gray-50 p-2"><b className="capitalize">{item.status}</b> · {item.reference_number}{item.rejection_reason ? ` — ${item.rejection_reason}` : ''}</div>)}</div></details>}
    {error && <p className="mt-2 text-xs text-[#a03030]">{error}</p>}
  </section>
}
