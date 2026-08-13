'use client'

import Link from 'next/link'
import Image from 'next/image'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { getHiroSuggestions } from '@/app/lib/hiroSuggestions'

type ChatMessage = {
  id: string
  role: 'hiro' | 'user' | 'system'
  text: string
  links?: Array<{ label: string; href: string }>
  intent?: string
  createdAt?: string
}

type ConversationState = {
  id: string
  status: 'active' | 'closed'
  lastActivity: string
  inactivityMs: number
}

type BusinessBrief = {
  greeting: string
  summary: string
  insights: Array<{ kind: 'network' | 'pair' | 'payout' | 'sales'; text: string; question: string; href: string }>
  dailyPlan: {
    title: string
    summary: string
    question: string
    actions: Array<{ kind: 'network' | 'pair' | 'payout' | 'sales' | 'learning'; text: string; reason: string; question: string }>
  }
  networkOpportunity: {
    left: { members: number; points: number; status: 'Strong branch' | 'Needs attention' | 'Growth opportunity'; question: string }
    right: { members: number; points: number; status: 'Strong branch' | 'Needs attention' | 'Growth opportunity'; question: string }
    gap: number
    insight: string
    question: string
  }
}
type ConversationPayload = { messages?: ChatMessage[]; conversation?: ConversationState; coach?: BusinessBrief | null; error?: string }

export function HiroPet({ small = false }: { small?: boolean }) {
  return (
    <span className={`${small ? 'h-10 w-10' : 'h-14 w-14'} relative inline-flex shrink-0 items-center justify-center`} aria-hidden="true">
      <span className="absolute inset-[18%] rounded-full bg-[#D8A62A]/25 blur-md" />
      <Image
        src="/images/hiro/hiro-mascot-floating.png"
        alt=""
        width={56}
        height={56}
        className="relative h-full w-full object-contain drop-shadow-[0_5px_5px_rgba(13,27,62,.32)]"
      />
    </span>
  )
}

export default function HiroAssistant({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversation, setConversation] = useState<ConversationState | null>(null)
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [coach, setCoach] = useState<BusinessBrief | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const accountQuestions = useMemo(() => [
    ...(coach ? [coach.networkOpportunity.question, coach.networkOpportunity.left.question, coach.networkOpportunity.right.question] : []),
    ...(coach?.dailyPlan.actions.map((action) => action.question) || []),
    ...(coach?.insights.map((insight) => insight.question) || []),
  ], [coach])
  const suggestionContext = useMemo(() => coach
    ? `${coach.summary}:${coach.networkOpportunity.insight}:${coach.dailyPlan.actions.map((action) => `${action.kind}:${action.reason}`).join('|')}`
    : '', [coach])
  const suggestions = getHiroSuggestions(messages, conversation?.id, accountQuestions, suggestionContext)
  const coachInsights = useMemo(() => {
    if (!coach?.insights.length) return []
    const day = new Date().toISOString().slice(0, 10)
    const source = `${conversation?.id || 'hiro'}:${day}:${suggestionContext}`
    const seed = [...source].reduce((total, character) => total + character.charCodeAt(0), 0)
    const offset = seed % coach.insights.length
    return [...coach.insights.slice(offset), ...coach.insights.slice(0, offset)]
  }, [coach, conversation?.id, suggestionContext])
  const dailyActions = useMemo(() => {
    if (!coach?.dailyPlan.actions.length) return []
    const day = new Date().toISOString().slice(0, 10)
    const source = `${conversation?.id || 'hiro'}:${day}:${suggestionContext}:actions`
    const seed = [...source].reduce((total, character) => total + character.charCodeAt(0), 0)
    const offset = seed % coach.dailyPlan.actions.length
    return [...coach.dailyPlan.actions.slice(offset), ...coach.dailyPlan.actions.slice(0, offset)]
  }, [coach, conversation?.id, suggestionContext])

  function applyConversation(data: ConversationPayload) {
    if (data.messages) setMessages(data.messages)
    if (data.conversation) setConversation(data.conversation)
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, sending])

  useEffect(() => {
    let active = true
    void fetch('/api/reseller/hiro', { cache: 'no-store' })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!active) return
        if (!ok) throw new Error(data.error || 'Unable to load Hiro conversation.')
        applyConversation(data)
        setCoach(data.coach || null)
      })
      .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load Hiro.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!conversation || conversation.status !== 'active') return
    const elapsed = Date.now() - new Date(conversation.lastActivity).getTime()
    const remaining = Math.max(0, conversation.inactivityMs - elapsed)
    const timer = window.setTimeout(() => {
      void fetch('/api/reseller/hiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', reason: 'inactivity' }),
      }).then((response) => response.json()).then(applyConversation)
        .catch(() => setError('The inactivity timer could not close this conversation.'))
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [conversation])

  async function ask(text: string, coachKind?: BusinessBrief['insights'][number]['kind'] | 'today') {
    const clean = text.trim()
    if (!clean || sending || conversation?.status === 'closed') return
    setQuestion('')
    setError('')
    setSending(true)
    try {
      const response = await fetch('/api/reseller/hiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: clean, coachKind }),
      })
      const data = await response.json()
      applyConversation(data)
      if (!response.ok) throw new Error(data.error || 'Hiro could not answer your question.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Hiro is temporarily unavailable.')
    } finally {
      setSending(false)
    }
  }

  async function startNewChat() {
    setSending(true)
    setError('')
    try {
      const response = await fetch('/api/reseller/hiro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to start a new conversation.')
      applyConversation(data)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to start a new conversation.')
    } finally {
      setSending(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void ask(question)
  }

  return (
    <div className={`overflow-hidden border border-[#0D1B3E]/10 bg-white shadow-xl ${compact ? 'rounded-2xl' : 'rounded-3xl'}`}>
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#010521] px-4 py-3 text-white">
        <HiroPet small />
        <div>
          <h2 className="text-sm font-semibold">Hiro Smart Assistant</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/55"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online - Built into Hiroma</p>
        </div>
      </div>

      <div className={`${compact ? 'h-[310px]' : 'h-[440px]'} overflow-y-auto bg-[#F5F7FB] px-3 py-4 sm:px-5`}>
        <div className="mx-auto max-w-3xl space-y-4">
          {coach && !loading && (
            <section className="overflow-hidden rounded-2xl border border-[#C9A84C]/30 bg-gradient-to-br from-[#071330] to-[#0D1B3E] text-white shadow-lg">
              <div className="border-b border-white/10 px-4 py-3">
                <p className="text-base font-bold">{coach.greeting}</p>
                <p className="mt-1 text-xs leading-5 text-white/65">{coach.summary}</p>
              </div>
              <div className={`grid gap-2 p-3 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
                {coachInsights.slice(0, compact ? 2 : 4).map((insight) => (
                  <button type="button" key={insight.kind} onClick={() => void ask(insight.question, insight.kind)} disabled={sending || conversation?.status === 'closed'} className="rounded-xl border border-white/10 bg-white/8 px-3 py-2.5 text-left text-xs leading-5 text-white/85 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50">
                    <span className="mb-1 block font-semibold capitalize text-[#F0CC69]">{insight.kind === 'pair' ? 'Next pair' : insight.kind}</span>
                    {insight.text}
                    <span className="mt-2 block font-semibold text-[#F0CC69]">Ask Hiro for advice →</span>
                  </button>
                ))}
              </div>
              {conversation?.status !== 'closed' && (
                <div className="border-t border-white/10 p-3">
              <div className="mb-3 rounded-xl border border-white/10 bg-black/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="text-sm font-bold text-white">Network Opportunity Map</p><p className="mt-1 text-[11px] text-white/55">Verified team position and descriptive coaching</p></div>
                  <button type="button" onClick={() => void ask(coach.networkOpportunity.question, 'network')} disabled={sending} className="rounded-lg border border-[#F0CC69]/40 bg-[#F0CC69]/10 px-3 py-1.5 text-[11px] font-semibold text-[#F0CC69] hover:bg-[#F0CC69]/20 disabled:opacity-50">Ask Hiro to analyze</button>
                </div>
                <div className={`mt-3 grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {(['left', 'right'] as const).map((side) => {
                    const branch = coach.networkOpportunity[side]
                    const tone = branch.status === 'Strong branch' ? 'bg-blue-400' : branch.status === 'Needs attention' ? 'bg-amber-400' : 'bg-emerald-400'
                    return <button key={side} type="button" onClick={() => void ask(branch.question, 'network')} disabled={sending} className="rounded-xl border border-white/10 bg-white/8 p-3 text-left transition hover:bg-white/15 disabled:opacity-50"><span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-white"><span className={`h-2.5 w-2.5 rounded-full ${tone}`} />{side} Team</span><span className="mt-2 block text-lg font-bold text-white">{branch.members} members</span><span className="block text-[11px] text-white/55">{branch.points.toLocaleString()} carryover points</span><span className="mt-2 block text-xs font-semibold text-[#F0CC69]">{branch.status}</span></button>
                  })}
                </div>
                <p className="mt-3 rounded-lg bg-white/6 px-3 py-2 text-[11px] leading-5 text-white/65"><span className="font-semibold text-[#F0CC69]">Hiro insight: </span>{coach.networkOpportunity.insight}</p>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">{coach.dailyPlan.title}</p>
                  <p className="mt-1 text-xs text-white/60">{coach.dailyPlan.summary}</p>
                </div>
                <button type="button" onClick={() => void ask(coach.dailyPlan.question, 'today')} disabled={sending} className="rounded-lg border border-[#F0CC69]/40 bg-[#F0CC69]/10 px-3 py-2 text-xs font-semibold text-[#F0CC69] hover:bg-[#F0CC69]/20 disabled:opacity-50">Ask Hiro</button>
              </div>
              <div className={`mt-3 grid gap-2 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
                {dailyActions.slice(0, compact ? 3 : 5).map((action, index) => (
                  <button key={action.kind} type="button" onClick={() => void ask(action.question, action.kind === 'learning' ? 'today' : action.kind)} disabled={sending} className="flex gap-2 rounded-xl border border-white/10 bg-white/8 px-3 py-2.5 text-left transition hover:bg-white/15 disabled:opacity-50">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F0CC69]/15 text-[10px] font-bold text-[#F0CC69]">{index + 1}</span>
                    <span><span className="block text-xs font-semibold text-white">{action.text}</span><span className="mt-0.5 block text-[11px] leading-4 text-white/55">{action.reason}</span></span>
                  </button>
                ))}
              </div>
                </div>
              )}
            </section>
          )}
          {loading && <div className="py-10 text-center text-sm text-gray-400">Loading your Hiro conversation...</div>}
          {messages.map((message) => message.role === 'system' ? (
            <div key={message.id} className="mx-auto max-w-[92%] rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs leading-5 text-amber-800">{message.text}</div>
          ) : (
            <div key={message.id} className={`flex gap-2.5 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.role === 'hiro' && <HiroPet small />}
              <div className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.role === 'user' ? 'rounded-br-md bg-[#0D1B3E] text-white' : 'rounded-bl-md border border-[#0D1B3E]/8 bg-white text-[#273552]'}`}>
                <p>{message.text}</p>
                {!!message.links?.length && <div className="mt-3 flex flex-wrap gap-2">{message.links.map((link) => <Link key={`${message.id}-${link.href}`} href={link.href} className="rounded-lg bg-[#fff5d6] px-3 py-1.5 text-xs font-semibold text-[#8A6514] hover:bg-[#F3DF9A]">{link.label}</Link>)}</div>}
              </div>
            </div>
          ))}
          {sending && <div className="flex items-center gap-2.5"><HiroPet small /><div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-gray-400 shadow-sm">Hiro is thinking...</div></div>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-[#0D1B3E]/8 bg-white p-3 sm:p-4">
        {!compact && conversation?.status !== 'closed' && <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void ask(suggestion)} disabled={sending} className="shrink-0 rounded-full border border-[#C9A84C]/35 bg-[#fffaf0] px-3 py-1.5 text-xs font-medium text-[#8A6514] hover:bg-[#fff2c9] disabled:opacity-50">{suggestion}</button>)}</div>}
        {conversation?.status === 'closed' ? (
          <button type="button" onClick={() => void startNewChat()} disabled={sending} className="w-full rounded-xl bg-[#0D1B3E] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Start new conversation</button>
        ) : (
          <form onSubmit={submit} className="flex gap-2">
            <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} disabled={loading || sending} placeholder="Chat with Hiro..." className="min-w-0 flex-1 rounded-xl border border-[#0D1B3E]/15 bg-[#F7F8FC] px-3 py-2.5 text-sm outline-none focus:border-[#C9A84C] focus:ring-2 focus:ring-[#C9A84C]/15" />
            <button disabled={loading || sending || !question.trim()} className="rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-semibold text-[#0D1B3E] disabled:opacity-50">Send</button>
          </form>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {!compact && <p className="mt-2 text-[11px] text-gray-400">Inactive conversations close automatically after five minutes and are deleted after seven days.</p>}
      </div>
    </div>
  )
}
