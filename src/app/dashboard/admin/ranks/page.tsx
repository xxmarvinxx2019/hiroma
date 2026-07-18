'use client'

import { useState, useEffect } from 'react'

interface Package { id: string; name: string; point_php_value: number }
interface Rank    { id?: string; package_id: string; name: string; sequence: number; required_pu: number; pair_income: number }
interface Period  { id?: string; package_id: string; start_date: string; end_date: string; is_active: boolean }

const fmt     = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

const EMPTY_RANK = (pkgId: string, seq: number): Rank => ({ package_id: pkgId, name: '', sequence: seq, required_pu: 0, pair_income: 0 })

export default function AdminRanksPage() {
  const [packages, setPackages]         = useState<Package[]>([])
  const [allRanks, setAllRanks]         = useState<Rank[]>([])
  const [allPeriods, setAllPeriods]     = useState<Period[]>([])
  const [loading, setLoading]           = useState(true)
  const [activeTab, setActiveTab]       = useState('')
  const [editRank, setEditRank]         = useState<Rank | null>(null)
  const [addingRank, setAddingRank]     = useState(false)
  const [newRank, setNewRank]           = useState<Rank | null>(null)
  const [editPeriod, setEditPeriod]     = useState<Period | null>(null)
  const [addingPeriod, setAddingPeriod] = useState(false)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')

  const fetchData = () => {
    setLoading(true)
    fetch('/api/admin/ranks')
      .then(r => r.json())
      .then(d => {
        setPackages(d.packages || [])
        setAllRanks(d.ranks    || [])
        setAllPeriods(d.periods || [])
        if (d.packages?.length && !activeTab) setActiveTab(d.packages[0].id)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const activeRanks   = allRanks.filter(r => r.package_id === activeTab).sort((a, b) => a.sequence - b.sequence)
  const activePeriods = allPeriods.filter(p => p.package_id === activeTab)
  const activePkg     = packages.find(p => p.id === activeTab)
  const nextSeq       = activeRanks.length > 0 ? Math.max(...activeRanks.map(r => r.sequence)) + 1 : 1

  const handleSaveRank = async (rank: Rank) => {
    setSaving(true); setError('')
    const res  = await fetch('/api/admin/ranks', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(rank),
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setError(data.error); return }
    setEditRank(null); setAddingRank(false); setNewRank(null)
    fetchData()
  }

  const handleSavePeriod = async (period: Period) => {
    setSaving(true); setError('')
    const res  = await fetch('/api/admin/ranks', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'period', package_id: activeTab, ...period, period_id: period.id }),
    })
    const data = await res.json()
    setSaving(false)
    if (data.error) { setError(data.error); return }
    setEditPeriod(null); setAddingPeriod(false)
    fetchData()
  }

  const handleDelete = async (id: string, type: 'rank' | 'period') => {
    if (!confirm(`Delete this ${type}?`)) return
    await fetch('/api/admin/ranks', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, type }),
    })
    fetchData()
  }

  const now = new Date()
  const isActivePeriod = (p: Period) => new Date(p.start_date) <= now && new Date(p.end_date) >= now

  return (
    <div className="max-w-3xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Rank System</h1>
        <p className="text-sm text-gray-400 mt-0.5">Configure rank milestones per package with custom names and active periods</p>
      </div>

      {/* Info banner */}
      <div className="bg-[#0D1B3E]/5 border border-[#0D1B3E]/10 rounded-xl px-4 py-3 mb-5 text-xs text-gray-500 leading-relaxed">
        <p className="font-medium text-[#0D1B3E] mb-1">How it works</p>
        Each package has its own rank milestones with custom names. Ranks are only active during the configured <strong>rank period</strong>.
        When the period ends, all resellers reset to their package's base points per pair.
        Rule: <strong>2 PU left + 2 PU right = 1 pair</strong>. Each point = <strong>₱0.50</strong>.
      </div>

      {/* Package tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {packages.map(pkg => (
          <button key={pkg.id} onClick={() => { setActiveTab(pkg.id); setError('') }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === pkg.id ? 'bg-[#0D1B3E] text-white' : 'bg-white border border-[#0D1B3E]/10 text-gray-500 hover:text-[#0D1B3E]'
            }`}>
            {pkg.name}
            <span className="text-[10px] ml-1.5 opacity-60">base {pkg.point_php_value} pts</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" /></div>
      ) : activeTab && (
        <div className="space-y-4">

          {/* ── Rank Period ── */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-[#0D1B3E]">Rank Period</p>
                <p className="text-xs text-gray-400">Ranks are only active within this date range</p>
              </div>
              {!addingPeriod && (
                <button onClick={() => { setAddingPeriod(true); setEditPeriod({ package_id: activeTab, start_date: '', end_date: '', is_active: true }) }}
                  className="text-xs text-[#C9A84C] hover:underline">+ Set Period</button>
              )}
            </div>

            {activePeriods.length === 0 && !addingPeriod && (
              <p className="text-xs text-gray-400 text-center py-3">No rank period set — ranks are inactive</p>
            )}

            {activePeriods.map(period => (
              <div key={period.id} className="flex items-center gap-3 py-2 border-b border-[#0D1B3E]/5 last:border-0">
                {editPeriod?.id === period.id ? (
                  <div className="flex-1 flex gap-2 items-center flex-wrap">
                    <input type="date" value={editPeriod.start_date?.split('T')[0]}
                      onChange={e => setEditPeriod({ ...editPeriod, start_date: e.target.value })}
                      className="border border-[#0D1B3E]/15 rounded-lg px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                    <span className="text-xs text-gray-400">to</span>
                    <input type="date" value={editPeriod.end_date?.split('T')[0]}
                      onChange={e => setEditPeriod({ ...editPeriod, end_date: e.target.value })}
                      className="border border-[#0D1B3E]/15 rounded-lg px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                    <button onClick={() => handleSavePeriod(editPeriod)} disabled={saving}
                      className="text-xs text-[#1a7a4a] font-medium hover:underline disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                    <button onClick={() => setEditPeriod(null)} className="text-xs text-gray-400 hover:text-[#0D1B3E]">Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${isActivePeriod(period) ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fef9ee] text-[#9a6f1e]'}`}>
                          {isActivePeriod(period) ? '● Active' : '○ Inactive'}
                        </span>
                        <p className="text-xs text-[#0D1B3E]">{fmtDate(period.start_date)} → {fmtDate(period.end_date)}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEditPeriod({ ...period })}
                        className="w-6 h-6 rounded bg-[#eef0f8] hover:bg-[#0D1B3E] flex items-center justify-center transition-colors group">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button onClick={() => handleDelete(period.id!, 'period')}
                        className="w-6 h-6 rounded bg-[#fdecea] hover:bg-[#a03030] flex items-center justify-center transition-colors group">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#a03030] group-hover:text-white">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}

            {addingPeriod && editPeriod && !editPeriod.id && (
              <div className="flex gap-2 items-center flex-wrap pt-2">
                <input type="date" value={editPeriod.start_date}
                  onChange={e => setEditPeriod({ ...editPeriod, start_date: e.target.value })}
                  className="border border-[#0D1B3E]/15 rounded-lg px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                <span className="text-xs text-gray-400">to</span>
                <input type="date" value={editPeriod.end_date}
                  onChange={e => setEditPeriod({ ...editPeriod, end_date: e.target.value })}
                  className="border border-[#0D1B3E]/15 rounded-lg px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                <button onClick={() => handleSavePeriod(editPeriod)} disabled={saving}
                  className="text-xs bg-[#0D1B3E] text-white px-3 py-1 rounded-lg disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                <button onClick={() => { setAddingPeriod(false); setEditPeriod(null) }} className="text-xs text-gray-400">Cancel</button>
              </div>
            )}
          </div>

          {/* ── Ranks ── */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/8">
              <div>
                <p className="text-sm font-semibold text-[#0D1B3E]">Rank Milestones</p>
                <p className="text-xs text-gray-400">Custom rank names — ordered by sequence. Base = {activePkg?.point_php_value} pts/pair</p>
              </div>
              <button onClick={() => { setAddingRank(true); setNewRank(EMPTY_RANK(activeTab, nextSeq)); setError('') }}
                className="text-xs text-[#C9A84C] hover:underline font-medium">+ Add Rank</button>
            </div>

            {/* Table header */}
            <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8] text-[10px] text-gray-400 uppercase tracking-wide font-medium">
              <p>#</p><p>Rank Name</p><p>Required PU</p><p>Points/Pair</p><p>PHP/Pair</p>
            </div>

            {activeRanks.length === 0 && !addingRank ? (
              <p className="text-xs text-gray-400 text-center py-8">No ranks configured — resellers use base package points</p>
            ) : (
              <>
                {activeRanks.map(rank => (
                  <div key={rank.id} className="border-b border-[#0D1B3E]/5 last:border-0">
                    {editRank?.id === rank.id ? (
                      <div className="grid grid-cols-5 gap-2 px-4 py-2 items-center">
                        <input type="number" min="1" value={editRank.sequence}
                          onChange={e => setEditRank({ ...editRank, sequence: Number(e.target.value) })}
                          className="border border-[#0D1B3E]/15 rounded px-2 py-1 text-xs outline-none focus:border-[#C9A84C] w-12" />
                        <input value={editRank.name}
                          onChange={e => setEditRank({ ...editRank, name: e.target.value })}
                          placeholder="e.g. Star"
                          className="border border-[#0D1B3E]/15 rounded px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                        <input type="number" min="0" value={editRank.required_pu}
                          onChange={e => setEditRank({ ...editRank, required_pu: Number(e.target.value) })}
                          className="border border-[#0D1B3E]/15 rounded px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                        <input type="number" min="0" value={editRank.pair_income}
                          onChange={e => setEditRank({ ...editRank, pair_income: Number(e.target.value) })}
                          className="border border-[#0D1B3E]/15 rounded px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                        <div className="flex gap-1.5">
                          <button onClick={() => handleSaveRank(editRank)} disabled={saving}
                            className="text-xs text-[#1a7a4a] font-medium hover:underline disabled:opacity-50">{saving ? '...' : 'Save'}</button>
                          <button onClick={() => setEditRank(null)} className="text-xs text-gray-400">✕</button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-5 px-4 py-3 items-center hover:bg-[#F8F9FC] transition-colors">
                        <p className="text-xs text-gray-400 font-mono">{rank.sequence}</p>
                        <p className="text-xs font-semibold text-[#0D1B3E]">{rank.name}</p>
                        <p className="text-xs text-[#0D1B3E]">{rank.required_pu} PU</p>
                        <p className="text-xs font-semibold text-[#1a7a4a]">{rank.pair_income} pts</p>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-400">{fmt(rank.pair_income * 0.50)}</p>
                          <div className="flex gap-1">
                            <button onClick={() => setEditRank({ ...rank })}
                              className="w-6 h-6 rounded bg-[#eef0f8] hover:bg-[#0D1B3E] flex items-center justify-center transition-colors group">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                            <button onClick={() => handleDelete(rank.id!, 'rank')}
                              className="w-6 h-6 rounded bg-[#fdecea] hover:bg-[#a03030] flex items-center justify-center transition-colors group">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#a03030] group-hover:text-white">
                                <path d="M18 6L6 18M6 6l12 12"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add new rank row */}
                {addingRank && newRank && (
                  <div className="grid grid-cols-5 gap-2 px-4 py-2 items-center bg-[#fef9ee] border-t border-[#C9A84C]/20">
                    <input type="number" min="1" value={newRank.sequence}
                      onChange={e => setNewRank({ ...newRank, sequence: Number(e.target.value) })}
                      className="border border-[#C9A84C]/40 rounded px-2 py-1 text-xs outline-none focus:border-[#C9A84C] w-12" />
                    <input value={newRank.name}
                      onChange={e => setNewRank({ ...newRank, name: e.target.value })}
                      placeholder="Rank name"
                      className="border border-[#C9A84C]/40 rounded px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                    <input type="number" min="0" value={newRank.required_pu || ''}
                      onChange={e => setNewRank({ ...newRank, required_pu: Number(e.target.value) })}
                      placeholder="PU needed"
                      className="border border-[#C9A84C]/40 rounded px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                    <input type="number" min="0" value={newRank.pair_income || ''}
                      onChange={e => setNewRank({ ...newRank, pair_income: Number(e.target.value) })}
                      placeholder="pts/pair"
                      className="border border-[#C9A84C]/40 rounded px-2 py-1 text-xs outline-none focus:border-[#C9A84C]" />
                    <div className="flex gap-1.5">
                      <button onClick={() => handleSaveRank(newRank)} disabled={saving || !newRank.name}
                        className="text-xs bg-[#C9A84C] text-white px-2 py-1 rounded disabled:opacity-50">{saving ? '...' : 'Add'}</button>
                      <button onClick={() => { setAddingRank(false); setNewRank(null) }} className="text-xs text-gray-400">✕</button>
                    </div>
                  </div>
                )}
              </>
            )}

            {error && <p className="text-xs text-[#a03030] px-4 py-2">{error}</p>}
          </div>

          {/* Visual summary */}
          {activeRanks.length > 0 && (
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
              <p className="text-xs font-medium text-[#0D1B3E] mb-3">Progression for {activePkg?.name}</p>
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {/* Base */}
                <div className="flex flex-col items-center min-w-[80px]">
                  <div className="w-10 h-10 rounded-full bg-[#eef0f8] flex items-center justify-center text-lg">👤</div>
                  <p className="text-[9px] text-gray-400 mt-1 text-center">Base</p>
                  <p className="text-[9px] font-semibold text-[#0D1B3E]">{activePkg?.point_php_value} pts</p>
                  <p className="text-[9px] text-gray-400">0 PU</p>
                </div>
                {activeRanks.map((rank, idx) => (
                  <div key={rank.id} className="flex items-center gap-2">
                    <div className="flex flex-col items-center">
                      <div className="w-px h-3 bg-gray-200" />
                      <p className="text-[9px] text-gray-300">{rank.required_pu} PU →</p>
                    </div>
                    <div className="flex flex-col items-center min-w-[80px]">
                      <div className="w-10 h-10 rounded-full bg-[#fef9ee] border-2 border-[#C9A84C] flex items-center justify-center text-sm font-bold text-[#C9A84C]">
                        {rank.sequence}
                      </div>
                      <p className="text-[9px] font-semibold text-[#0D1B3E] mt-1 text-center">{rank.name}</p>
                      <p className="text-[9px] text-[#1a7a4a] font-semibold">{rank.pair_income} pts</p>
                      <p className="text-[9px] text-gray-400">{fmt(rank.pair_income * 0.50)}/pair</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}