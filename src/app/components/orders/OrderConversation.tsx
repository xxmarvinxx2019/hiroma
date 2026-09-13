'use client'
import { FormEvent, useCallback, useEffect, useState } from 'react'
type Message = { id: string; sender_id: string; sender_name: string; sender_role: string; message: string; created_at: string }
export default function OrderConversation({ orderId }: { orderId: string }) {
  const [messages, setMessages] = useState<Message[]>([]), [accountId, setAccountId] = useState(''), [closed, setClosed] = useState(false)
  const [draft, setDraft] = useState(''), [loading, setLoading] = useState(true), [sending, setSending] = useState(false), [error, setError] = useState('')
  const load = useCallback(async () => { try { const response = await fetch(`/api/orders/${orderId}/messages`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load messages.'); setMessages(data.messages || []); setClosed(Boolean(data.closed)); setAccountId(data.accountId || '') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load messages.') } finally { setLoading(false) } }, [orderId])
  useEffect(() => {
    const controller = new AbortController()
    const request = fetch(`/api/orders/${orderId}/messages`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || 'Unable to load messages.')
        setMessages(data.messages || [])
        setClosed(Boolean(data.closed))
        setAccountId(data.accountId || '')
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'Unable to load messages.')
        }
      })
      .finally(() => setLoading(false))
    void request
    return () => controller.abort()
  }, [orderId])
  async function send(event: FormEvent) { event.preventDefault(); if (!draft.trim() || sending || closed) return; setSending(true); setError(''); try { const response = await fetch(`/api/orders/${orderId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: draft }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to send message.'); setDraft(''); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to send message.') } finally { setSending(false) } }
  return <section className="rounded-2xl border border-[#0D1B3E]/8 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[#0D1B3E]">Order messages</p><p className="mt-0.5 text-[10px] text-gray-400">Private to the reseller and assigned City/Branch.</p></div><button type="button" onClick={() => void load()} className="text-[10px] font-semibold text-[#9a741f]">Refresh</button></div>
    <div className="mt-3 max-h-52 space-y-2 overflow-y-auto rounded-xl bg-[#F7F8FC] p-3">{loading ? <p className="text-center text-xs text-gray-400">Loading messages…</p> : messages.length === 0 ? <p className="text-center text-xs text-gray-400">No messages yet. Use this thread only for this order.</p> : messages.map(item => <div key={item.id} className={`flex ${item.sender_id === accountId ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-xl px-3 py-2 ${item.sender_id === accountId ? 'bg-[#0D1B3E] text-white' : 'border bg-white text-[#0D1B3E]'}`}><p className="text-[10px] font-semibold opacity-70">{item.sender_name} · {item.sender_role.replaceAll('_', ' ')}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs">{item.message}</p><p className="mt-1 text-[9px] opacity-55">{new Date(item.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p></div></div>)}</div>
    {closed ? <p className="mt-3 rounded-xl bg-gray-100 px-3 py-2 text-center text-xs text-gray-500">Conversation closed. History remains available for audit.</p> : <form onSubmit={send} className="mt-3 flex gap-2"><textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} rows={2} placeholder="Message about this order…" className="min-w-0 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-[#C9A84C]"/><button disabled={sending || !draft.trim()} className="rounded-xl bg-[#0D1B3E] px-4 text-xs font-semibold text-white disabled:opacity-40">{sending ? 'Sending…' : 'Send'}</button></form>}{error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}</section>
}
