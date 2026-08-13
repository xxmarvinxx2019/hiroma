'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Verification = {
  verified: boolean
  member: { member_id: string; full_name: string; status: string }
}

export default function MemberVerificationPage() {
  const params = useParams<{ memberId: string }>()
  const [result, setResult] = useState<Verification | null>(null)
  const [message, setMessage] = useState('Verifying member...')

  useEffect(() => {
    if (!params.memberId) return
    fetch(`/api/public/member-verification/${encodeURIComponent(params.memberId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Verification failed.')
        setResult(data)
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Verification failed.'))
  }, [params.memberId])

  return (
    <main className="min-h-screen bg-[#f2f4f9] px-5 py-16 text-[#0d1b3e]">
      <section className="mx-auto max-w-md overflow-hidden rounded-3xl border border-[#0d1b3e]/10 bg-white shadow-2xl shadow-[#0d1b3e]/10">
        <div className="bg-[#091331] px-8 py-7 text-white">
          <p className="text-xs font-bold tracking-[0.2em] text-[#e1b84d]">HIROMA</p>
          <h1 className="mt-2 text-2xl font-bold">Member verification</h1>
        </div>
        <div className="p-8">
          {!result ? <p className="text-sm text-slate-500">{message}</p> : <>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${result.verified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {result.verified ? 'Verified active member' : 'Member is not active'}
            </span>
            <h2 className="mt-5 text-2xl font-bold">{result.member.full_name}</h2>
            <p className="mt-1 font-mono text-sm text-[#a67a19]">{result.member.member_id}</p>
            <p className="mt-6 border-t border-slate-100 pt-5 text-sm leading-6 text-slate-500">This page confirms Hiroma membership status only. It does not disclose login, contact, address, password, PIN, or financial information.</p>
          </>}
        </div>
      </section>
    </main>
  )
}
