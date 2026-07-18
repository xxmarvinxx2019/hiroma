'use client'

import { useState, useEffect, useCallback, memo } from 'react'

interface TreeNode {
  id: string; user_id: string; username: string; full_name: string
  package_name: string | null; position: string | null
  left_child: TreeNode | null; right_child: TreeNode | null
  depth: number; is_self: boolean
  direct_referral_earned: number; binary_pairing_earned: number
  product_points_earned: number; total_earned: number
  left_count: number; right_count: number
  pairing_bonus_value: number; pending_pairing_balance: number
  left_points: number; right_points: number
  rank: string; total_pu: number
}

interface TreeMeta {
  node_id: string; position: string | null
  left_count: number; right_count: number
  sponsor: { username: string; full_name: string } | null
  parent: { id: string; user: { username: string; full_name: string } } | null
}

interface MyEarnings {
  direct_referral: number; binary_pairing: number
  product_points: number; total_earned: number
  wallet_balance: number; total_withdrawn: number
  total_points: number; pending_pairing_balance: number
  package: string | null; rank: string; total_pu: number
}

interface SearchResult {
  user_id: string; username: string; full_name: string
  position: string | null; left_count: number; right_count: number
  package_name: string | null; rank: string | null; total_pu: number | null
}

const RANK_PALETTE = [
  { bg: '#fef6e4', text: '#9a6f1e', bar: '#C9A84C' },
  { bg: '#f0f2f5', text: '#6b7280', bar: '#9ca3af' },
  { bg: '#fef9ee', text: '#b7860b', bar: '#eab308' },
  { bg: '#f0f7ff', text: '#2563eb', bar: '#2563eb' },
  { bg: '#e8f7ef', text: '#1a7a4a', bar: '#1a7a4a' },
]

const fmt = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Empty Slot ──
function EmptySlot() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-[130px] border-2 border-dashed border-[#0D1B3E]/15 rounded-xl px-2 py-4 flex flex-col items-center gap-1 bg-[#F8F9FC]">
        <div className="w-9 h-9 rounded-full bg-[#0D1B3E]/5 flex items-center justify-center">
          <span className="text-gray-300 text-xl font-light">+</span>
        </div>
        <p className="text-[10px] text-gray-300">Open slot</p>
      </div>
    </div>
  )
}

// ── Node Card ──
const NodeCard = memo(function NodeCard({ node, isRoot, onNavigate, onSelect }: {
  node: TreeNode; isRoot?: boolean
  onNavigate?: (userId: string) => void
  onSelect?: (node: TreeNode) => void
}) {
  const hasBinaryEarnings  = node.binary_pairing_earned  > 0
  const hasProductEarnings = node.product_points_earned  > 0
  const hasEarnings        = node.total_earned > 0
  const hasCarryOver       = node.left_points > 0 || node.right_points > 0
  const rankColor          = node.rank && node.rank !== 'default'
    ? (RANK_PALETTE[0]?.text || '#C9A84C')
    : '#9ca3af'

  return (
    <div className="relative flex flex-col items-center">
      <div
        onClick={() => onSelect?.(node)}
        className={`relative w-[130px] border-2 rounded-xl px-2.5 py-3 flex flex-col items-center gap-1 shadow-sm cursor-pointer transition-all duration-150 hover:scale-105 hover:shadow-md active:scale-95 ${
          node.is_self ? 'bg-[#0D1B3E] border-[#C9A84C]' : 'bg-white border-[#0D1B3E]/10 hover:border-[#C9A84C]/50'
        }`}
      >
        {node.is_self && (
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[#C9A84C] text-[#0D1B3E] text-[9px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap">You</span>
        )}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${node.is_self ? 'bg-[#C9A84C] text-white' : 'bg-[#0D1B3E]/8 text-[#0D1B3E]'}`}>
          {node.full_name.charAt(0).toUpperCase()}
        </div>
        <p className={`text-[10px] font-semibold text-center leading-tight truncate w-full ${node.is_self ? 'text-white' : 'text-[#0D1B3E]'}`}>
          {node.full_name.split(' ')[0]}
        </p>
        <p className={`text-[9px] truncate w-full text-center ${node.is_self ? 'text-[#C9A84C]' : 'text-gray-400'}`}>
          @{node.username}
        </p>
        {node.package_name && (
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${node.is_self ? 'bg-white/20 text-white' : 'bg-[#0D1B3E]/8 text-[#0D1B3E]'}`}>
            {node.package_name}
          </span>
        )}
        {node.rank && node.rank !== 'default' && (
          <span className="text-[8px] font-medium capitalize" style={{ color: node.is_self ? '#C9A84C' : rankColor }}>
            🏅 {node.rank}
          </span>
        )}
        {node.position && !isRoot && (
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full capitalize ${node.position === 'left' ? 'bg-[#f0f7ff] text-[#2563eb]' : 'bg-[#fef9ee] text-[#9a6f1e]'}`}>
            {node.position}
          </span>
        )}
        <div className="flex gap-1.5 mt-0.5">
          <span className="text-[8px] text-[#2563eb] font-medium">L:{node.left_count}</span>
          <span className="text-[8px] text-gray-300">·</span>
          <span className="text-[8px] text-[#9a6f1e] font-medium">R:{node.right_count}</span>
        </div>
        {(hasBinaryEarnings || hasProductEarnings) && (
          <div className="flex gap-1 mt-0.5 flex-wrap justify-center">
            {hasBinaryEarnings  && <span className="text-[8px] bg-[#e8f7ef] text-[#1a7a4a] px-1 py-0.5 rounded-full font-medium">B:{fmt(node.binary_pairing_earned)}</span>}
            {hasProductEarnings && <span className="text-[8px] bg-[#f0f7ff] text-[#2563eb] px-1 py-0.5 rounded-full font-medium">P:{fmt(node.product_points_earned)}</span>}
          </div>
        )}
        {hasCarryOver && (
          <div className={`w-full text-center text-[8px] ${node.is_self ? 'text-[#C9A84C]/70' : 'text-[#9a6f1e]'}`}>
            {node.left_points}↑ {node.right_points}↑
          </div>
        )}
        {hasEarnings && (
          <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[#1a7a4a] rounded-full border-2 border-white" />
        )}
      </div>

    </div>
  )
})

// ── Connector ──
function Connector({ hasLeft, hasRight }: { hasLeft: boolean; hasRight: boolean }) {
  if (!hasLeft && !hasRight) return null
  return (
    <div className="flex justify-center w-full my-0">
      <div className="relative flex items-start justify-center w-full max-w-[320px]">
        <div className="absolute top-0 left-1/2 w-px h-4 bg-[#0D1B3E]/15 -translate-x-1/2" />
        <div className="absolute top-4 left-[25%] right-[25%] h-px bg-[#0D1B3E]/15" />
        {hasLeft  && <div className="absolute top-4 left-[25%]  w-px h-4 bg-[#0D1B3E]/15" />}
        {hasRight && <div className="absolute top-4 right-[25%] w-px h-4 bg-[#0D1B3E]/15" />}
        <div className="h-8" />
      </div>
    </div>
  )
}

// ── Tree Level ──
function TreeLevel({ node, isRoot, onNavigate, onSelect }: {
  node: TreeNode; isRoot?: boolean
  onNavigate?: (userId: string) => void
  onSelect?: (node: TreeNode) => void
}) {
  const hasLeft      = !!node.left_child
  const hasRight     = !!node.right_child
  const showChildren = hasLeft || hasRight || node.depth < 3

  return (
    <div className="flex flex-col items-center">
      <NodeCard node={node} isRoot={isRoot} onNavigate={onNavigate} onSelect={onSelect} />
      {showChildren && <Connector hasLeft={hasLeft || node.depth < 3} hasRight={hasRight || node.depth < 3} />}
      {showChildren && (
        <div className="flex gap-6 items-start">
          <div className="flex flex-col items-center">
            {node.left_child  ? <TreeLevel node={node.left_child}  onNavigate={onNavigate} onSelect={onSelect} /> : <EmptySlot />}
          </div>
          <div className="flex flex-col items-center">
            {node.right_child ? <TreeLevel node={node.right_child} onNavigate={onNavigate} onSelect={onSelect} /> : <EmptySlot />}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──
export default function ResellerTreePage() {
  const [tree, setTree]         = useState<TreeNode | null>(null)
  const [meta, setMeta]         = useState<TreeMeta | null>(null)
  const [earnings, setEarnings] = useState<MyEarnings | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [rootUserId, setRootUserId]           = useState<string | null>(null)
  const [searchInput, setSearchInput]         = useState('')
  const [searchResults, setSearchResults]     = useState<SearchResult[]>([])
  const [searching, setSearching]             = useState(false)
  const [selectedResult, setSelectedResult]   = useState<SearchResult | null>(null)
  const [selectedNode, setSelectedNode]         = useState<TreeNode | null>(null)

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    const res = await fetch(`/api/reseller/tree?search=${encodeURIComponent(q)}`)
    const data = await res.json()
    setSearchResults(data.results || [])
    setSearching(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => handleSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput, handleSearch])

  const fetchTree = useCallback(() => {
    setLoading(true); setError('')
    const params = new URLSearchParams({ depth: '4' })
    if (rootUserId) params.set('root_user_id', rootUserId)
    fetch(`/api/reseller/tree?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setTree(data.tree)
        setMeta(data.meta)
        setEarnings(data.my_earnings)
      })
      .catch(() => setError('Failed to load tree.'))
      .finally(() => setLoading(false))
  }, [rootUserId])

  useEffect(() => { fetchTree() }, [fetchTree])

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Binary Tree</h1>
          <p className="text-sm text-gray-400 mt-0.5">Hover any node to see earnings breakdown</p>
        </div>
        {rootUserId && (
          <button onClick={() => setRootUserId(null)}
            className="h-8 px-3 rounded-lg text-xs bg-[#fdecea] text-[#a03030] hover:bg-[#fcd9d9] transition-colors font-medium">
            ← My Tree
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative mb-5">
        <div className={`flex items-center gap-3 bg-white rounded-2xl border-2 px-4 py-3 transition-all shadow-sm ${searchInput ? 'border-[#C9A84C]' : 'border-[#0D1B3E]/10 hover:border-[#0D1B3E]/20'}`}>
          <div className="flex-shrink-0">
            {searching ? (
              <div className="w-4 h-4 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={searchInput ? 'text-[#C9A84C]' : 'text-gray-300'}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            )}
          </div>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search your downline by name or username..."
            className="flex-1 text-sm text-[#0D1B3E] outline-none placeholder:text-gray-300 bg-transparent" />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearchResults([]) }}
              className="w-6 h-6 rounded-full bg-[#0D1B3E]/8 flex items-center justify-center text-gray-400 hover:bg-[#0D1B3E] hover:text-white transition-colors flex-shrink-0">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>

        {/* Search Results */}
        {searchInput && (searchResults.length > 0 || (!searching && searchInput)) && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl border border-[#0D1B3E]/8 shadow-xl z-50 overflow-hidden">
            {searchResults.length > 0 ? (
              <>
                <div className="px-4 py-2.5 border-b border-[#0D1B3E]/5">
                  <p className="text-[11px] text-gray-400 font-medium">{searchResults.length} member{searchResults.length !== 1 ? 's' : ''} found in your downline</p>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {searchResults.map((r) => (
                    <div key={r.user_id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-[#F8F9FC] transition-colors border-b border-[#0D1B3E]/5 last:border-0 cursor-pointer"
                      onClick={() => setSelectedResult(r)}>
                      <div className="w-9 h-9 rounded-full bg-[#0D1B3E] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        {r.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#0D1B3E] truncate">{r.full_name}</p>
                        <p className="text-[11px] text-gray-400">@{r.username}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {r.package_name && <span className="text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-0.5 rounded-full">{r.package_name}</span>}
                        {r.rank && r.rank !== 'default' && <span className="text-[10px] bg-[#fef9ee] text-[#C9A84C] px-2 py-0.5 rounded-full capitalize font-medium">🏅 {r.rank}</span>}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300"><path d="M9 18l6-6-6-6"/></svg>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : !searching ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-gray-400">No members found</p>
                <p className="text-xs text-gray-300 mt-1">Try a different name or username</p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* My Earnings */}
      {earnings && (
        <div className="space-y-3 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Wallet Balance',  value: fmt(earnings.wallet_balance),          color: '#1a7a4a' },
              { label: 'Total Earned',    value: fmt(earnings.total_earned),            color: '#0D1B3E' },
              { label: 'Total Withdrawn', value: fmt(earnings.total_withdrawn),         color: '#a03030' },
              { label: 'Carry Over',      value: `${earnings.pending_pairing_balance} pts`, color: '#C9A84C', sub: 'Remaining binary pts' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.color}` }}>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className="text-xl font-semibold" style={{ color: s.color }}>{s.value}</p>
                {'sub' in s && s.sub && <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Direct Referral',  value: fmt(earnings.direct_referral), color: '#C9A84C', icon: '👥' },
              { label: 'Binary Pairing',   value: fmt(earnings.binary_pairing),  color: '#1a7a4a', icon: '🔗' },
              { label: 'Product Points',   value: fmt(earnings.product_points),  color: '#2563eb', icon: '📦' },
              { label: 'Pairing Points',   value: `${earnings.total_points.toLocaleString()} pts`, color: '#9a6f1e', icon: '⭐', sub: `≈ ${fmt(earnings.total_points * 0.50)}` },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.color}` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">{s.icon}</span>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{s.label}</p>
                </div>
                <p className="text-xl font-semibold" style={{ color: s.color }}>{s.value}</p>
                {'sub' in s && s.sub && <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meta */}
      {meta && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Left Leg',  value: String(meta.left_count),  color: '#2563eb', isNum: true },
            { label: 'Right Leg', value: String(meta.right_count), color: '#9a6f1e', isNum: true },
            { label: 'Sponsor',   value: meta.sponsor?.full_name || '—', color: '#0D1B3E', isNum: false },
            { label: 'Position',  value: meta.position ? meta.position.charAt(0).toUpperCase() + meta.position.slice(1) : '—', color: '#C9A84C', isNum: false },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.color}` }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
              {s.isNum
                ? <p className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</p>
                : <p className="text-sm font-semibold text-[#0D1B3E] truncate">{s.value}</p>
              }
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mb-4 px-1">
        {[
          { icon: <div className="w-4 h-4 rounded bg-[#0D1B3E] border-2 border-[#C9A84C]" />, label: 'You' },
          { icon: <div className="w-4 h-4 rounded bg-white border-2 border-[#0D1B3E]/10" />, label: 'Downline' },
          { icon: <div className="w-4 h-4 rounded bg-[#F8F9FC] border-2 border-dashed border-[#0D1B3E]/15" />, label: 'Open slot' },
          { icon: <span className="text-[8px] bg-[#e8f7ef] text-[#1a7a4a] px-1.5 py-0.5 rounded-full font-medium">B:₱X</span>, label: 'Binary' },
          { icon: <span className="text-[8px] bg-[#f0f7ff] text-[#2563eb] px-1.5 py-0.5 rounded-full font-medium">P:₱X</span>, label: 'Product' },
        ].map((l, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {l.icon}
            <span className="text-xs text-gray-400">{l.label}</span>
          </div>
        ))}
      </div>

      {/* Tree */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-6 overflow-x-auto">
        {loading ? (
          <div className="flex flex-col items-center py-16">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Loading tree...</p>
          </div>
        ) : error ? (
          <p className="text-center text-[#a03030] text-sm py-16">{error}</p>
        ) : tree ? (
          <div className="flex justify-center min-w-max mx-auto">
            <TreeLevel node={tree} isRoot onNavigate={(uid) => setRootUserId(uid)} onSelect={(n) => setSelectedNode(n)} />
          </div>
        ) : (
          <p className="text-center text-gray-400 text-sm py-16">No tree data found.</p>
        )}
      </div>

      {/* Node Detail Modal */}
      {selectedNode && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedNode(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-[#0D1B3E] px-5 py-5 relative">
              <button onClick={() => setSelectedNode(null)}
                className="absolute top-4 right-4 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-[#C9A84C] flex items-center justify-center text-white text-xl font-bold">
                  {selectedNode.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-semibold text-base">{selectedNode.full_name}</p>
                  <p className="text-white/50 text-sm">@{selectedNode.username}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {selectedNode.package_name && <span className="bg-[#C9A84C]/20 text-[#C9A84C] text-[10px] px-2 py-0.5 rounded-full">{selectedNode.package_name}</span>}
                    {selectedNode.rank && selectedNode.rank !== 'default' && <span className="bg-white/10 text-white text-[10px] px-2 py-0.5 rounded-full capitalize">🏅 {selectedNode.rank}</span>}
                    {selectedNode.is_self && <span className="bg-[#C9A84C] text-[#0D1B3E] text-[10px] px-2 py-0.5 rounded-full font-bold">You</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Left / Right */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#f0f7ff] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#2563eb]">{selectedNode.left_count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Left Leg</p>
                </div>
                <div className="bg-[#fef9ee] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#9a6f1e]">{selectedNode.right_count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Right Leg</p>
                </div>
              </div>

              {/* Earnings */}
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2">Earnings</p>
                <div className="space-y-2">
                  {[
                    { label: 'Direct Referral', value: fmt(selectedNode.direct_referral_earned), color: '#C9A84C' },
                    { label: 'Binary Pairing',  value: fmt(selectedNode.binary_pairing_earned),  color: '#1a7a4a' },
                    { label: 'Product Points',  value: fmt(selectedNode.product_points_earned),  color: '#2563eb' },
                    { label: 'Total Earned',    value: fmt(selectedNode.total_earned),            color: '#0D1B3E', bold: true },
                  ].map((e) => (
                    <div key={e.label} className={`flex justify-between items-center py-1.5 ${e.bold ? 'border-t border-[#0D1B3E]/8 pt-2' : ''}`}>
                      <span className="text-sm text-gray-400">{e.label}</span>
                      <span className={`text-sm font-semibold`} style={{ color: e.color }}>{e.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Binary Stats */}
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2">Binary Stats</p>
                <div className="space-y-1.5">
                  {selectedNode.total_pu > 0 && (
                    <div className="flex justify-between"><span className="text-sm text-gray-400">Total PU</span><span className="text-sm font-semibold text-[#0D1B3E]">{selectedNode.total_pu} PU</span></div>
                  )}
                  <div className="flex justify-between"><span className="text-sm text-gray-400">Position</span><span className={`text-sm font-semibold capitalize ${selectedNode.position === 'left' ? 'text-[#2563eb]' : 'text-[#9a6f1e]'}`}>{selectedNode.position || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-sm text-gray-400">Carry Over (L)</span><span className="text-sm font-semibold text-[#0D1B3E]">{selectedNode.left_points} pts</span></div>
                  <div className="flex justify-between"><span className="text-sm text-gray-400">Carry Over (R)</span><span className="text-sm font-semibold text-[#0D1B3E]">{selectedNode.right_points} pts</span></div>
                </div>
              </div>

              {/* Actions */}
              {!selectedNode.is_self && (
                <button onClick={() => { setRootUserId(selectedNode.user_id); setSelectedNode(null) }}
                  className="w-full py-2.5 rounded-xl bg-[#0D1B3E] text-white text-sm font-medium hover:bg-[#162850] transition-colors">
                  🌳 View Their Tree
                </button>
              )}
              <button onClick={() => setSelectedNode(null)}
                className="w-full py-2 rounded-xl border border-[#0D1B3E]/15 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Member Detail Modal */}
      {selectedResult && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedResult(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-[#0D1B3E] px-5 py-5 relative">
              <button onClick={() => setSelectedResult(null)}
                className="absolute top-4 right-4 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-[#C9A84C] flex items-center justify-center text-white text-xl font-bold">
                  {selectedResult.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-semibold text-base">{selectedResult.full_name}</p>
                  <p className="text-white/50 text-sm">@{selectedResult.username}</p>
                  {selectedResult.package_name && (
                    <span className="inline-block mt-1 bg-[#C9A84C]/20 text-[#C9A84C] text-[10px] px-2 py-0.5 rounded-full">{selectedResult.package_name}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#f0f7ff] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#2563eb]">{selectedResult.left_count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Left Leg</p>
                </div>
                <div className="bg-[#fef9ee] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#9a6f1e]">{selectedResult.right_count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Right Leg</p>
                </div>
              </div>
              <div className="space-y-2">
                {selectedResult.rank && selectedResult.rank !== 'default' && (
                  <div className="flex items-center justify-between py-2 border-b border-[#0D1B3E]/5">
                    <span className="text-sm text-gray-400">Rank</span>
                    <span className="text-sm font-semibold text-[#C9A84C] capitalize">🏅 {selectedResult.rank}</span>
                  </div>
                )}
                {selectedResult.total_pu != null && selectedResult.total_pu > 0 && (
                  <div className="flex items-center justify-between py-2 border-b border-[#0D1B3E]/5">
                    <span className="text-sm text-gray-400">Total PU</span>
                    <span className="text-sm font-semibold text-[#0D1B3E]">{selectedResult.total_pu} PU</span>
                  </div>
                )}
                <div className="flex items-center justify-between py-2 border-b border-[#0D1B3E]/5">
                  <span className="text-sm text-gray-400">Position</span>
                  <span className={`text-sm font-semibold capitalize ${selectedResult.position === 'left' ? 'text-[#2563eb]' : 'text-[#9a6f1e]'}`}>
                    {selectedResult.position || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-400">Total Downline</span>
                  <span className="text-sm font-semibold text-[#0D1B3E]">{(selectedResult.left_count + selectedResult.right_count).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => { setRootUserId(selectedResult.user_id); setSelectedResult(null); setSearchInput(''); setSearchResults([]) }}
                  className="flex-1 py-2.5 rounded-xl bg-[#0D1B3E] text-white text-sm font-medium hover:bg-[#162850] transition-colors">
                  🌳 View Their Tree
                </button>
                <button onClick={() => setSelectedResult(null)}
                  className="px-4 py-2.5 rounded-xl border border-[#0D1B3E]/15 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}