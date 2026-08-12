'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'

const ticketTypes = [
  ['account_access', 'Account access / login'], ['profile_and_verification', 'Profile / verification'],
  ['digital_id', 'Digital ID'], ['registration_and_pin', 'Registration / PIN'],
  ['referral_and_sponsorship', 'Referral / sponsor'], ['binary_tree_and_genealogy', 'Binary tree / genealogy'],
  ['commissions_and_points', 'Commissions / points'], ['wallet_and_payout', 'Wallet / payout'],
  ['orders_and_delivery', 'Orders / delivery'], ['products_and_pricing', 'Products / pricing'],
  ['payment_issue', 'Payment issue'], ['website_or_app_problem', 'Website / app problem'],
  ['security_and_account_safety', 'Security / account safety'], ['other', 'Other — specify below'],
]

type Captcha = { id: string; question: string }

export default function SupportRequestForm({ member = false, mode = 'feedback', onDone }: { member?: boolean; mode?: 'feedback' | 'ticket'; onDone?: () => void }) {
  const ticket = mode === 'ticket'
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState(ticket ? 'account_access' : 'suggestion')
  const [captcha, setCaptcha] = useState<Captcha | null>(null)

  const refreshCaptcha = useCallback(async () => {
    if (member) return
    const response = await fetch('/api/public/support-captcha', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Unable to load human verification.')
    setCaptcha({ id: data.id, question: data.question })
  }, [member])

  useEffect(() => {
    if (member) return
    let active = true
    fetch('/api/public/support-captcha', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load human verification.')
        if (active) setCaptcha({ id: data.id, question: data.question })
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load human verification.') })
    return () => { active = false }
  }, [member])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setError('')
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form))
    try {
      let screenshot = ''
      if (file) {
        if (file.size > 3 * 1024 * 1024) throw new Error('Screenshot must be 3 MB or smaller.')
        screenshot = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      }
      const response = await fetch('/api/public/support-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, captcha_id: captcha?.id, screenshot, screenshot_name: file?.name }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to submit.')
      setSuccess(result.message)
      form.reset()
      setFile(null)
      await refreshCaptcha()
      onDone?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit.')
      await refreshCaptcha().catch(() => undefined)
    } finally {
      setSending(false)
    }
  }

  return <form onSubmit={submit} className="space-y-4">
    <input name="website" tabIndex={-1} className="hidden" />
    {!member && <div className="grid gap-3 sm:grid-cols-2"><input required name="name" placeholder="Your name" className="rounded-xl border px-4 py-3 text-sm" /><input required type="email" name="email" placeholder="Email address" className="rounded-xl border px-4 py-3 text-sm" /></div>}
    <div className="grid gap-3 sm:grid-cols-[230px_1fr]"><label className="text-xs font-semibold text-[#0D1B3E]">Type<select name="category" value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3 text-sm">{ticket ? ticketTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>) : <><option value="account_access">Account recovery</option><option value="suggestion">Suggestion</option><option value="feedback">Feedback</option></>}</select></label><label className="text-xs font-semibold text-[#0D1B3E]">Subject<input required name="subject" minLength={4} placeholder={ticket ? 'Briefly describe the issue' : 'What would you like to improve?'} className="mt-1 w-full rounded-xl border px-4 py-3 text-sm" /></label></div>
    {ticket && category === 'other' && <label className="block text-xs font-semibold text-[#0D1B3E]">Please specify your concern<input required name="category_detail" minLength={4} maxLength={200} placeholder="Example: I need help with…" className="mt-1 w-full rounded-xl border px-4 py-3 text-sm" /></label>}
    <label className="block text-xs font-semibold text-[#0D1B3E]">{ticket ? 'Describe the problem' : 'Your feedback'}<textarea required name="message" minLength={10} rows={6} placeholder={ticket ? 'Tell us what happened, what you expected, and any error message.' : 'Share your idea or feedback…'} className="mt-1 w-full rounded-xl border px-4 py-3 text-sm leading-6" /></label>
    {ticket && <label className="block rounded-xl border border-dashed border-[#C9A84C]/70 bg-[#fffaf0] p-4 text-sm text-[#0D1B3E]"><span className="font-semibold">Upload screenshot <span className="font-normal text-gray-500">(optional, PNG/JPG/WebP, max 3 MB)</span></span><input type="file" accept="image/png,image/jpeg,image/webp" className="mt-2 block text-xs" onChange={(event) => setFile(event.target.files?.[0] || null)} />{file && <p className="mt-2 text-xs text-[#9a741f]">Attached: {file.name}</p>}</label>}
    {!member && <div className="rounded-xl border border-[#0D1B3E]/15 bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#9a741f]">Hiroma Human Check</p><div className="mt-2 flex flex-wrap items-center gap-3"><span className="font-semibold text-[#0D1B3E]">{captcha?.question || 'Loading…'}</span><input required name="captcha_answer" inputMode="numeric" autoComplete="off" aria-label="Human verification answer" className="w-24 rounded-lg border px-3 py-2 text-sm" disabled={!captcha} /><button type="button" onClick={() => refreshCaptcha().catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to refresh verification.'))} className="text-xs font-semibold text-[#9a741f]">New question</button></div><p className="mt-2 text-xs text-gray-500">Answer this easy question to protect Hiroma Support from automated spam.</p></div>}
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {success && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">✓ {success}</p>}
    <button disabled={sending || (!member && !captcha)} className="rounded-xl bg-[#C9A84C] px-5 py-3 text-sm font-semibold text-[#0D1B3E] disabled:opacity-50">{sending ? 'Submitting…' : ticket ? 'Create Ticket' : category === 'account_access' ? 'Request account recovery' : category === 'suggestion' ? 'Send suggestion' : 'Send feedback'}</button>
  </form>
}
