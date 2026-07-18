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

const fmt = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Empty Slot ──
function EmptySlot() {
  return (
    <div style={{
      width: 140, height: 200,
      border: '2px dashed rgba(13,27,62,0.12)',
      borderRadius: 16,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 6, background: '#f8f9fc',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: 'rgba(13,27,62,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(13,27,62,0.2)', fontSize: 20, fontWeight: 300,
      }}>+</div>
      <p style={{ fontSize: 11, color: 'rgba(13,27,62,0.25)', margin: 0 }}>Open Slot</p>
    </div>
  )
}

// ── Node Card ──
const NodeCard = memo(function NodeCard({ node, isRoot, onNavigate, onSelect }: {
  node: TreeNode; isRoot?: boolean
  onNavigate?: (userId: string) => void
  onSelect?: (node: TreeNode) => void
}) {
  const posColor   = node.position === 'left' ? '#3b82f6' : node.position === 'right' ? '#f59e0b' : '#9ca3af'
  const hasEarnings = node.total_earned > 0
  const initial    = node.full_name.charAt(0).toUpperCase()
  const avatarBg   = node.is_self ? '#C9A84C' : `hsl(${node.username.charCodeAt(0) * 37 % 360}, 60%, 75%)`

  return (
    <div
      onClick={() => onSelect?.(node)}
      style={{
        width: 140, height: 200,
        background: node.is_self ? '#0D1B3E' : '#ffffff',
        border: `2px solid ${node.is_self ? '#C9A84C' : 'rgba(13,27,62,0.08)'}`,
        borderRadius: 16,
        boxShadow: node.is_self ? '0 4px 20px rgba(13,27,62,0.3)' : '0 2px 8px rgba(13,27,62,0.06)',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '12px 8px',
        position: 'relative',
        transition: 'transform 0.15s, box-shadow 0.15s',
        boxSizing: 'border-box',
        gap: 3,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)'; (e.currentTarget as HTMLDivElement).style.boxShadow = node.is_self ? '0 8px 24px rgba(13,27,62,0.4)' : '0 4px 16px rgba(13,27,62,0.12)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLDivElement).style.boxShadow = node.is_self ? '0 4px 20px rgba(13,27,62,0.3)' : '0 2px 8px rgba(13,27,62,0.06)' }}
    >
      {/* You badge */}
      {node.is_self && (
        <div style={{
          position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
          background: '#C9A84C', color: '#0D1B3E',
          fontSize: 9, fontWeight: 700, padding: '2px 10px',
          borderRadius: 20, whiteSpace: 'nowrap',
        }}>You</div>
      )}

      {/* Avatar */}
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: avatarBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, fontWeight: 700,
        color: node.is_self ? '#0D1B3E' : '#fff',
        flexShrink: 0,
      }}>{initial}</div>

      {/* Name */}
      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: node.is_self ? '#fff' : '#0D1B3E', textAlign: 'center', lineHeight: 1.2, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {node.full_name}
      </p>
      <p style={{ margin: 0, fontSize: 9, color: node.is_self ? 'rgba(255,255,255,0.5)' : '#9ca3af', textAlign: 'center' }}>
        @{node.username}
      </p>

      {/* Package */}
      {node.package_name && (
        <div style={{ background: node.is_self ? 'rgba(255,255,255,0.15)' : 'rgba(13,27,62,0.06)', borderRadius: 20, padding: '1px 8px', fontSize: 9, color: node.is_self ? '#C9A84C' : '#0D1B3E', fontWeight: 600 }}>
          {node.package_name}
        </div>
      )}

      {/* Rank */}
      {node.rank && node.rank !== 'default' && (
        <p style={{ margin: 0, fontSize: 9, color: '#C9A84C', fontWeight: 600 }}>🏅 {node.rank}</p>
      )}

      {/* Position */}
      {node.position && (
        <div style={{ background: posColor + '18', borderRadius: 20, padding: '1px 8px', fontSize: 9, color: posColor, fontWeight: 600 }}>
          {node.position.charAt(0).toUpperCase() + node.position.slice(1)}
        </div>
      )}

      {/* L/R counts */}
      <p style={{ margin: 0, fontSize: 9, color: node.is_self ? 'rgba(255,255,255,0.5)' : '#9ca3af' }}>
        L{node.left_count} · R{node.right_count}
      </p>

      {/* Earnings pills */}
      {(node.binary_pairing_earned > 0 || node.product_points_earned > 0) && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
          {node.binary_pairing_earned > 0 && (
            <div style={{ background: '#e8f7ef', color: '#1a7a4a', fontSize: 8, padding: '1px 5px', borderRadius: 8, fontWeight: 600 }}>
              {fmt(node.binary_pairing_earned)}
            </div>
          )}
          {node.product_points_earned > 0 && (
            <div style={{ background: '#eff6ff', color: '#2563eb', fontSize: 8, padding: '1px 5px', borderRadius: 8, fontWeight: 600 }}>
              {fmt(node.product_points_earned)}
            </div>
          )}
        </div>
      )}

      {/* Green dot for earnings */}
      {hasEarnings && (
        <div style={{
          position: 'absolute', bottom: -5, right: -5,
          width: 12, height: 12, borderRadius: '50%',
          background: '#1a7a4a', border: '2px solid #fff',
        }} />
      )}
    </div>
  )
})

// ── Tree Level with clean connectors ──
const GAP = 20 // gap between sibling subtrees

function TreeLevel({ node, isRoot, onNavigate, onSelect }: {
  node: TreeNode; isRoot?: boolean
  onNavigate?: (userId: string) => void
  onSelect?: (node: TreeNode) => void
}) {
  const showChildren = !!node.left_child || !!node.right_child || node.depth < 2
  const LINE = '1px solid rgba(13,27,62,0.18)'

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <NodeCard node={node} isRoot={isRoot} onNavigate={onNavigate} onSelect={onSelect} />

      {showChildren && (
        <>
          {/* Vertical stem */}
          <div style={{ width: 1, height: 24, background: 'rgba(13,27,62,0.18)' }} />

          {/* Row of children */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: GAP }}>
            {/* Left child */}
            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* ┐ corner — right side goes up to meet stem */}
              <div style={{ width: '50%', height: 24, borderTop: LINE, borderRight: LINE, alignSelf: 'flex-end' }} />
              {node.left_child
                ? <TreeLevel node={node.left_child}  onNavigate={onNavigate} onSelect={onSelect} />
                : <EmptySlot />}
            </div>

            {/* Right child */}
            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* └ corner — left side goes up to meet stem */}
              <div style={{ width: '50%', height: 24, borderTop: LINE, borderLeft: LINE, alignSelf: 'flex-start' }} />
              {node.right_child
                ? <TreeLevel node={node.right_child} onNavigate={onNavigate} onSelect={onSelect} />
                : <EmptySlot />}
            </div>
          </div>
        </>
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
  const [rootUserId, setRootUserId]         = useState<string | null>(null)
  const [searchInput, setSearchInput]       = useState('')
  const [searchResults, setSearchResults]   = useState<SearchResult[]>([])
  const [searching, setSearching]           = useState(false)
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [selectedNode, setSelectedNode]     = useState<TreeNode | null>(null)

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    const res  = await fetch(`/api/reseller/tree?search=${encodeURIComponent(q)}`)
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
    const params = new URLSearchParams({ depth: '2' })
    if (rootUserId) params.set('root_user_id', rootUserId)
    fetch(`/api/reseller/tree?${params}`)
      .then(r => r.json())
      .then(data => {
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
    <div className="w-full space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0D1B3E] flex items-center justify-center">
            <span className="text-xl">🌳</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#0D1B3E]">Network Tree</h1>
            <p className="text-xs text-gray-400">Showing 2 levels · Search to find deeper members</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Legend */}
          <div className="hidden md:flex items-center gap-3 bg-white rounded-xl border border-[#0D1B3E]/8 px-4 py-2">
            {[
              { color: '#C9A84C', label: 'You' },
              { color: '#3b82f6', label: 'Left' },
              { color: '#f59e0b', label: 'Right' },
              { color: 'rgba(13,27,62,0.12)', label: 'Open Slot', dashed: true },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ background: l.color, border: l.dashed ? '1.5px dashed rgba(13,27,62,0.3)' : 'none' }} />
                <span className="text-xs text-gray-400">{l.label}</span>
              </div>
            ))}
          </div>
          {rootUserId && (
            <button onClick={() => setRootUserId(null)}
              className="h-9 px-4 rounded-xl text-xs bg-[#fdecea] text-[#a03030] hover:bg-[#fcd9d9] transition-colors font-medium">
              ← My Tree
            </button>
          )}
        </div>
      </div>

      {/* Stat Cards */}
      {earnings && meta && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Earned',   value: fmt(earnings.total_earned),                     sub: `Wallet: ${fmt(earnings.wallet_balance)}`,  color: '#1a7a4a', icon: '💰' },
            { label: 'Left Leg',       value: String(meta.left_count),                         sub: 'Downline members',                         color: '#3b82f6', icon: '👥' },
            { label: 'Right Leg',      value: String(meta.right_count),                        sub: 'Downline members',                         color: '#f59e0b', icon: '👥' },
            { label: 'Pairing Points', value: `${earnings.total_points.toLocaleString()} pts`, sub: `≈ ${fmt(earnings.total_points * 0.50)}`,   color: '#C9A84C', icon: '⭐' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:border-[#C9A84C]/40 hover:shadow-sm transition-all">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-400 uppercase tracking-wide">{s.label}</p>
                <span className="text-lg">{s.icon}</span>
              </div>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[10px] text-gray-400 mt-1">{s.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <div className={`flex items-center gap-3 bg-white rounded-2xl border-2 px-4 py-3 transition-all shadow-sm ${searchInput ? 'border-[#C9A84C]' : 'border-[#0D1B3E]/8 hover:border-[#0D1B3E]/20'}`}>
          {searching
            ? <div className="w-4 h-4 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin flex-shrink-0" />
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={searchInput ? 'text-[#C9A84C]' : 'text-gray-300'}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          }
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="Search your downline by name or username..."
            className="flex-1 text-sm text-[#0D1B3E] outline-none placeholder:text-gray-300 bg-transparent" />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearchResults([]) }}
              className="w-6 h-6 rounded-full bg-[#0D1B3E]/8 flex items-center justify-center text-gray-400 hover:bg-[#0D1B3E] hover:text-white transition-colors">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>
        {searchInput && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl border border-[#0D1B3E]/8 shadow-xl z-50 overflow-hidden">
            {searchResults.length > 0 ? (
              <>
                <div className="px-4 py-2.5 border-b border-[#0D1B3E]/5">
                  <p className="text-[11px] text-gray-400 font-medium">{searchResults.length} member{searchResults.length !== 1 ? 's' : ''} found</p>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {searchResults.map(r => (
                    <div key={r.user_id} onClick={() => setSelectedResult(r)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-[#F8F9FC] cursor-pointer border-b border-[#0D1B3E]/5 last:border-0 transition-colors">
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

      {/* Tree Container */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 shadow-sm overflow-auto p-8">
        {loading ? (
          <div className="flex flex-col items-center py-20">
            <div className="w-8 h-8 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Loading your network tree...</p>
          </div>
        ) : error ? (
          <p className="text-center text-[#a03030] text-sm py-16">{error}</p>
        ) : tree ? (
          <div style={{ display: 'flex', justifyContent: 'center', minWidth: 'max-content', margin: '0 auto' }}>
            <TreeLevel node={tree} isRoot onNavigate={uid => setRootUserId(uid)} onSelect={n => setSelectedNode(n)} />
          </div>
        ) : (
          <p className="text-center text-gray-400 text-sm py-16">No tree data found.</p>
        )}
      </div>

      {/* Node Detail Modal */}
      {selectedNode && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedNode(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
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
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#eff6ff] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#3b82f6]">{selectedNode.left_count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Left Leg</p>
                </div>
                <div className="bg-[#fffbeb] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#f59e0b]">{selectedNode.right_count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Right Leg</p>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'Direct Referral', value: fmt(selectedNode.direct_referral_earned), color: '#C9A84C' },
                  { label: 'Binary Pairing',  value: fmt(selectedNode.binary_pairing_earned),  color: '#1a7a4a' },
                  { label: 'Product Points',  value: fmt(selectedNode.product_points_earned),  color: '#2563eb' },
                  { label: 'Total Earned',    value: fmt(selectedNode.total_earned),            color: '#0D1B3E', bold: true },
                ].map(e => (
                  <div key={e.label} className={`flex justify-between items-center py-1.5 ${e.bold ? 'border-t border-[#0D1B3E]/8 pt-2.5' : ''}`}>
                    <span className="text-sm text-gray-400">{e.label}</span>
                    <span className="text-sm font-semibold" style={{ color: e.color }}>{e.value}</span>
                  </div>
                ))}
                {selectedNode.total_pu > 0 && (
                  <div className="flex justify-between items-center py-1.5">
                    <span className="text-sm text-gray-400">Total PU</span>
                    <span className="text-sm font-semibold text-[#C9A84C]">{selectedNode.total_pu} PU</span>
                  </div>
                )}
              </div>
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

      {/* Search Result Detail Modal */}
      {selectedResult && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedResult(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-[#0D1B3E] px-5 py-5 relative">
              <button onClick={() => setSelectedResult(null)}
                className="absolute top-4 right-4 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-[#C9A84C] flex items-center justify-center text-white text-xl font-bold">
                  {selectedResult.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-semibold text-base">{selectedResult.full_name}</p>
                  <p className="text-white/50 text-sm">@{selectedResult.username}</p>
                  {selectedResult.package_name && <span className="inline-block mt-1 bg-[#C9A84C]/20 text-[#C9A84C] text-[10px] px-2 py-0.5 rounded-full">{selectedResult.package_name}</span>}
                </div>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#eff6ff] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#3b82f6]">{selectedResult.left_count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Left Leg</p>
                </div>
                <div className="bg-[#fffbeb] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[#f59e0b]">{selectedResult.right_count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Right Leg</p>
                </div>
              </div>
              <div className="space-y-2">
                {selectedResult.rank && selectedResult.rank !== 'default' && (
                  <div className="flex justify-between py-1.5 border-b border-[#0D1B3E]/5">
                    <span className="text-sm text-gray-400">Rank</span>
                    <span className="text-sm font-semibold text-[#C9A84C] capitalize">🏅 {selectedResult.rank}</span>
                  </div>
                )}
                {selectedResult.total_pu != null && selectedResult.total_pu > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-[#0D1B3E]/5">
                    <span className="text-sm text-gray-400">Total PU</span>
                    <span className="text-sm font-semibold text-[#0D1B3E]">{selectedResult.total_pu} PU</span>
                  </div>
                )}
                <div className="flex justify-between py-1.5 border-b border-[#0D1B3E]/5">
                  <span className="text-sm text-gray-400">Position</span>
                  <span className="text-sm font-semibold capitalize" style={{ color: selectedResult.position === 'left' ? '#3b82f6' : '#f59e0b' }}>
                    {selectedResult.position || '—'}
                  </span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-sm text-gray-400">Total Downline</span>
                  <span className="text-sm font-semibold text-[#0D1B3E]">{(selectedResult.left_count + selectedResult.right_count).toLocaleString()}</span>
                </div>
              </div>
              <button onClick={() => { setRootUserId(selectedResult.user_id); setSelectedResult(null); setSearchInput(''); setSearchResults([]) }}
                className="w-full py-2.5 rounded-xl bg-[#0D1B3E] text-white text-sm font-medium hover:bg-[#162850] transition-colors">
                🌳 View Their Tree
              </button>
              <button onClick={() => setSelectedResult(null)}
                className="w-full py-2 rounded-xl border border-[#0D1B3E]/15 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}