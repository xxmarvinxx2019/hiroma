'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  deleteQueuedRegistration,
  listQueuedRegistrations,
  permanentReceiptNumber,
  saveQueuedRegistration,
  type PosQueuedRegistration,
  type PosReceiptRange,
} from '@/app/lib/posOfflineQueue'

type Bootstrap = {
  cashier: { full_name: string; username: string }
  terminal: { id: string; receipt_code: string }
  receipt_location_code: string
  receipt_range: PosReceiptRange
  open_shift: { id: string } | null
  catalog: Array<{ product_id: string; name: string; stock: number }>
  payment_methods: Array<{ id: string; type: string; account_name: string; account_number?: string }>
  registration_packages: Array<{
    id: string
    name: string
    total: number
    products: Array<{ product_id: string; name: string; quantity: number }>
  }>
}

const emptyApplicant = {
  first_name: '', middle_name: '', last_name: '', suffix: '', no_middle_name: false,
  full_name: '', birthday: '', birthplace: '', mobile: '', email: '',
  street_address: '', barangay_name: '', barangay_code: '', city_muni_name: '', city_muni_code: '',
  province_name: '', province_code: '', region_name: '', region_code: '', zip_code: '',
  referrer_username: '', preferred_position: '', identity_document_type: '', identity_document_reference: '', notes: '',
}

export default function NewPosRegistrationPage() {
  const [data, setData] = useState<Bootstrap | null>(null)
  const [online, setOnline] = useState(true)
  const [applicant, setApplicant] = useState(emptyApplicant)
  const [packageId, setPackageId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentReference, setPaymentReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<{ receipt: string; offline: boolean; status: string } | null>(null)

  useEffect(() => {
    const update = () => {
      const connected = navigator.onLine
      setOnline(connected)
      if (!connected) { setPaymentMethod('cash'); setPaymentReference('') }
    }
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    let cached: Bootstrap | null = null
    try { cached = JSON.parse(localStorage.getItem('hiroma_pos_bootstrap') || 'null') } catch { /* ignore damaged cache */ }
    if (cached) window.setTimeout(() => setData(cached), 0)
    const installationId = localStorage.getItem('hiroma_pos_installation_id')
    const receiptRange = JSON.parse(localStorage.getItem('hiroma_pos_receipt_range') || 'null')
    if (navigator.onLine && installationId) {
      fetch('/api/city/pos/bootstrap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installation_id: installationId, name: `POS ${installationId.slice(0, 8).toUpperCase()}`, platform: navigator.platform, receipt_range: receiptRange }),
      }).then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Unable to load POS registration.')
        setData(result)
        localStorage.setItem('hiroma_pos_bootstrap', JSON.stringify(result))
        localStorage.setItem('hiroma_pos_receipt_range', JSON.stringify(result.receipt_range))
      }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load POS registration.'))
    }
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  useEffect(() => {
    if (!online) return
    let cancelled = false
    async function synchronize() {
      const queued = await listQueuedRegistrations()
      for (const row of queued) {
        if (cancelled) return
        await saveQueuedRegistration({ ...row, status: 'syncing', error: undefined })
        try {
          const response = await fetch('/api/city/pos/registrations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row.payload),
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Registration synchronization needs attention.')
          await deleteQueuedRegistration(row.client_intake_id)
        } catch (reason) {
          await saveQueuedRegistration({ ...row, status: 'needs_attention', error: reason instanceof Error ? reason.message : 'Registration synchronization needs attention.' })
        }
      }
    }
    void synchronize()
    return () => { cancelled = true }
  }, [online])

  const selectedPackage = useMemo(() => data?.registration_packages.find((pkg) => pkg.id === packageId), [data, packageId])
  const stockReady = useMemo(() => selectedPackage?.products.every((item) => {
    const product = data?.catalog.find((row) => row.product_id === item.product_id)
    return (product?.stock || 0) >= item.quantity
  }) ?? false, [data, selectedPackage])

  function change(name: keyof typeof emptyApplicant, value: string | boolean) {
    setApplicant((current) => {
      const next = { ...current, [name]: value }
      next.full_name = [next.first_name, next.no_middle_name ? '' : next.middle_name, next.last_name, next.suffix].filter(Boolean).join(' ')
      return next
    })
  }

  async function submit() {
    setError('')
    if (!data?.open_shift) return setError('Open a cashier shift before accepting a registration.')
    if (!selectedPackage || !stockReady) return setError('Choose a package with enough physical stock at this location.')
    if (!applicant.first_name || !applicant.last_name || !applicant.birthday || !applicant.birthplace || !applicant.mobile || !applicant.street_address || !applicant.barangay_name || !applicant.city_muni_name || !applicant.region_name || !applicant.zip_code || !applicant.referrer_username) {
      return setError('Complete the legal name, birth details, mobile, complete address, and direct referrer.')
    }
    if (!online && paymentMethod !== 'cash') return setError('Offline registration accepts cash only.')
    if (paymentMethod !== 'cash' && !paymentReference.trim()) return setError('Enter the bank or e-wallet transaction reference.')
    const range = data.receipt_range
    if (range.next > range.end) return setError('This terminal must reconnect to reserve more permanent receipt numbers.')
    setSaving(true)
    try {
      const now = new Date()
      const clientId = crypto.randomUUID()
      const sequence = range.next
      const receipt = permanentReceiptNumber(data.receipt_location_code, data.terminal.receipt_code, now, sequence)
      const nextRange = { ...range, next: sequence + 1 }
      const payload = {
        client_intake_id: clientId,
        receipt_number: receipt,
        terminal_id: data.terminal.id,
        shift_id: data.open_shift.id,
        package_id: selectedPackage.id,
        applicant: {
          ...applicant,
          identity_document_number: applicant.identity_document_reference,
          address: {
            street_address: applicant.street_address,
            street: applicant.street_address,
            barangay_name: applicant.barangay_name,
            barangay_code: applicant.barangay_code,
            city_muni_name: applicant.city_muni_name,
            city_muni_code: applicant.city_muni_code,
            province_name: applicant.province_name,
            province_code: applicant.province_code,
            region_name: applicant.region_name,
            region_code: applicant.region_code,
            zip_code: applicant.zip_code,
          },
        },
        payment_method: paymentMethod,
        payment_reference: paymentMethod === 'cash' ? null : paymentReference.trim(),
        captured_offline: !online,
        local_created_at: now.toISOString(),
        notes: applicant.notes,
      }
      localStorage.setItem('hiroma_pos_receipt_range', JSON.stringify(nextRange))
      setData((current) => current ? { ...current, receipt_range: nextRange } : current)
      if (!online) {
        const queued: PosQueuedRegistration = { client_intake_id: clientId, receipt_number: receipt, payload, status: 'saved_offline', created_at: now.toISOString() }
        await saveQueuedRegistration(queued)
        const adjusted = {
          ...data,
          receipt_range: nextRange,
          catalog: data.catalog.map((row) => {
            const released = selectedPackage.products.find((item) => item.product_id === row.product_id)
            return released ? { ...row, stock: Math.max(0, row.stock - released.quantity) } : row
          }),
        }
        setData(adjusted)
        localStorage.setItem('hiroma_pos_bootstrap', JSON.stringify(adjusted))
        setSuccess({ receipt, offline: true, status: 'Released · Pending sync and registration encoding' })
      } else {
        const response = await fetch('/api/city/pos/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Unable to save registration intake.')
        setSuccess({ receipt, offline: false, status: result.registration.status })
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save registration intake.') }
    finally { setSaving(false) }
  }

  if (success) return <div className="mx-auto max-w-xl p-6"><div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm"><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Registration intake saved</p><h1 className="mt-2 text-2xl font-bold text-[#071638]">{success.receipt}</h1><p className="mt-3 text-sm text-slate-600">{success.status}</p>{success.offline && <p className="mt-2 text-sm text-amber-700">Cash only. The permanent receipt is retained and will synchronize when internet returns.</p>}<div className="mt-6 flex justify-center gap-3"><button onClick={() => { setApplicant(emptyApplicant); setPackageId(''); setSuccess(null) }} className="rounded-lg bg-[#C9A84C] px-5 py-2 font-semibold text-[#071638]">New intake</button><Link href="/dashboard/city/pos/registrations" className="rounded-lg border border-slate-300 px-5 py-2">View queue</Link></div></div></div>

  return <div className="mx-auto max-w-6xl p-6">
    <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A97912]">Point of Sale</p><h1 className="text-2xl font-bold text-[#071638]">New Reseller Registration Intake</h1><p className="text-sm text-slate-500">Cashier captures and receives. Account creation remains a separate reviewed encoding step.</p></div><div className={`rounded-full px-3 py-1 text-sm font-semibold ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{online ? 'Online' : 'Offline · Cash only'}</div></div>
    {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-4 font-bold text-[#071638]">Applicant information</h2><div className="grid gap-3 md:grid-cols-2">
        {(['first_name','middle_name','last_name','suffix','birthday','birthplace','mobile','email'] as const).map((name) => <label key={name} className="text-xs font-semibold capitalize text-slate-600">{name.replaceAll('_',' ')}<input type={name === 'birthday' ? 'date' : name === 'email' ? 'email' : 'text'} value={String(applicant[name])} onChange={(event) => change(name, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-[#071638]" /></label>)}
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={applicant.no_middle_name} onChange={(event) => change('no_middle_name', event.target.checked)} />Legally has no middle name</label>
      </div><h3 className="mb-3 mt-6 font-semibold">Complete address</h3><div className="grid gap-3 md:grid-cols-2">{(['street_address','barangay_name','barangay_code','city_muni_name','city_muni_code','province_name','province_code','region_name','region_code','zip_code'] as const).map((name) => <label key={name} className="text-xs font-semibold capitalize text-slate-600">{name.replaceAll('_',' ')}<input value={applicant[name]} onChange={(event) => change(name, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-[#071638]" /></label>)}</div>
      <h3 className="mb-3 mt-6 font-semibold">Referral and identity</h3><div className="grid gap-3 md:grid-cols-2">{(['referrer_username','preferred_position','identity_document_type','identity_document_reference'] as const).map((name) => <label key={name} className="text-xs font-semibold capitalize text-slate-600">{name.replaceAll('_',' ')}<input value={applicant[name]} onChange={(event) => change(name, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-[#071638]" /></label>)}</div></section>
      <aside className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold text-[#071638]">Package and payment</h2><label className="mt-4 block text-xs font-semibold text-slate-600">Registration package<select value={packageId} onChange={(event) => setPackageId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="">Choose package</option>{data?.registration_packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name} · ₱{pkg.total.toLocaleString()}</option>)}</select></label>{selectedPackage && <div className={`mt-3 rounded-xl p-3 text-sm ${stockReady ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{stockReady ? 'Physical package stock is available.' : 'Insufficient physical package stock.'}</div>}<label className="mt-4 block text-xs font-semibold text-slate-600">Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={!online} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><option value="cash">Cash</option>{online && data?.payment_methods.filter((item) => item.id !== 'cash').map((item) => <option key={item.id} value={item.id}>{item.type.toUpperCase()} · {item.account_name}</option>)}</select></label>{paymentMethod !== 'cash' && <label className="mt-3 block text-xs font-semibold text-slate-600">Transaction reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" /></label>}<div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Cash: package may be released immediately. Bank/e-wallet: do not release until an independent approver verifies actual receipt.</div><button disabled={saving || !data} onClick={() => void submit()} className="mt-5 w-full rounded-xl bg-[#C9A84C] px-4 py-3 font-bold text-[#071638] disabled:opacity-50">{saving ? 'Saving…' : 'Save registration intake'}</button></aside>
    </div>
  </div>
}
