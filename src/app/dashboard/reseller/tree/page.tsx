'use client'

import { useState, useEffect, useCallback, memo } from 'react'

interface TreeNode {
  id: string
  user_id: string
  username: string
  full_name: string
  package_name: string | null
  position: string | null
  left_child: TreeNode | null
  right_child: TreeNode | null
  depth: number
  is_self: boolean
  direct_referral_earned: number
  binary_pairing_earned:  number
  product_points_earned:  number
  total_earned:           number
  left_count:             number
  right_count:            number
  pairing_bonus_value:    number
  pending_pairing_balance: number
  left_points:            number
  right_points:           number
}

interface TreeMeta {
  node_id:     string
  position:    string | null
  left_count:  number
  right_count: number
  sponsor:     { username: string; full_name: string } | null
  parent:      { id: string; user: { username: string; full_name: string } } | null
}

interface MyEarnings {
  direct_referral:         number
  binary_pairing:          number
  product_points:          number
  total_earned:            number
  wallet_balance:          number
  total_withdrawn:         number
  total_points:            number
  pending_pairing_balance: number
  package:                 string | null
}

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
const NodeCard = memo(function NodeCard({ node, isRoot, onNavigate }: { node: TreeNode; isRoot?: boolean; onNavigate?: (userId: string) => void }) {
  const [showTooltip, setShowTooltip] = useState(false)

  const hasBinaryEarnings  = node.binary_pairing_earned > 0
  const hasProductEarnings = node.product_points_earned > 0
  const hasEarnings        = node.total_earned > 0
  const hasCarryOver       = node.left_points > 0 || node.right_points > 0

  return (
    <div className="relative flex flex-col items-center">
      <div
        className={`relative w-[130px] border-2 rounded-xl px-2.5 py-3 flex flex-col items-center gap-1 shadow-sm cursor-pointer transition-all duration-150 hover:scale-105 hover:shadow-md ${
          node.is_self
            ? 'bg-[#0D1B3E] border-[#C9A84C]'
            : 'bg-white border-[#0D1B3E]/10 hover:border-[#0D1B3E]/30'
        }`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {/* You badge */}
        {node.is_self && (
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[#C9A84C] text-[#0D1B3E] text-[9px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap">
            You
          </span>
        )}

        {/* Avatar */}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
          node.is_self ? 'bg-[#C9A84C] text-white' : 'bg-[#0D1B3E]/8 text-[#0D1B3E]'
        }`}>
          {node.full_name.charAt(0).toUpperCase()}
        </div>

        {/* Name */}
        <p className={`text-[10px] font-semibold text-center leading-tight truncate w-full ${node.is_self ? 'text-white' : 'text-[#0D1B3E]'}`}>
          {node.full_name.split(' ')[0]}
        </p>
        <p className={`text-[9px] truncate w-full text-center ${node.is_self ? 'text-[#C9A84C]' : 'text-gray-400'}`}>
          @{node.username}
        </p>

        {/* Package */}
        {node.package_name && (
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${node.is_self ? 'bg-white/20 text-white' : 'bg-[#0D1B3E]/8 text-[#0D1B3E]'}`}>
            {node.package_name}
          </span>
        )}

        {/* Position */}
        {node.position && !isRoot && (
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full capitalize ${
            node.position === 'left' ? 'bg-[#f0f7ff] text-[#2563eb]' : 'bg-[#fef9ee] text-[#9a6f1e]'
          }`}>
            {node.position}
          </span>
        )}

        {/* L/R counts */}
        <div className="flex gap-1.5 mt-0.5">
          <span className="text-[8px] text-[#2563eb] font-medium">L:{node.left_count}</span>
          <span className="text-[8px] text-gray-300">·</span>
          <span className="text-[8px] text-[#9a6f1e] font-medium">R:{node.right_count}</span>
        </div>

        {/* Earnings badges */}
        {(hasBinaryEarnings || hasProductEarnings) && (
          <div className="flex gap-1 mt-0.5 flex-wrap justify-center">
            {hasBinaryEarnings && (
              <span className="text-[8px] bg-[#e8f7ef] text-[#1a7a4a] px-1 py-0.5 rounded-full font-medium">
                B:{fmt(node.binary_pairing_earned)}
              </span>
            )}
            {hasProductEarnings && (
              <span className="text-[8px] bg-[#f0f7ff] text-[#2563eb] px-1 py-0.5 rounded-full font-medium">
                P:{fmt(node.product_points_earned)}
              </span>
            )}
          </div>
        )}

        {/* Carry over indicator */}
        {hasCarryOver && (
          <div className={`w-full text-center text-[8px] ${node.is_self ? 'text-[#C9A84C]/70' : 'text-[#9a6f1e]'}`}>
            {node.left_points}↑ {node.right_points}↑
          </div>
        )}

        {/* Has earnings dot */}
        {hasEarnings && (
          <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[#1a7a4a] rounded-full border-2 border-white" />
        )}
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          className="absolute top-full mt-2 z-50 bg-[#0D1B3E] text-white rounded-xl shadow-2xl p-3 w-56 text-xs space-y-1.5"
          style={{ left: '50%', transform: 'translateX(-50%)' }}
        >
          <p className="font-semibold text-[#C9A84C] border-b border-white/10 pb-1.5 mb-1">
            {node.full_name}
          </p>
          {!node.is_self && onNavigate && (
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate(node.user_id) }}
              className="w-full text-[10px] bg-[#C9A84C]/20 hover:bg-[#C9A84C]/40 text-[#C9A84C] rounded-lg py-1 mb-1 transition-colors">
              📍 View tree from here
            </button>
          )}

          {/* Earnings breakdown */}
          <p className="text-[10px] text-white/40 uppercase tracking-wide">Earnings</p>
          <div className="flex justify-between">
            <span className="text-white/60">Direct Referral</span>
            <span className="text-[#C9A84C] font-medium">{fmt(node.direct_referral_earned)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/60">Binary Pairing</span>
            <span className="text-[#1a7a4a] font-medium">{fmt(node.binary_pairing_earned)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/60">Product Points</span>
            <span className="text-[#2563eb] font-medium">{fmt(node.product_points_earned)}</span>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-1.5 font-semibold">
            <span>Total Earned</span>
            <span className="text-white">{fmt(node.total_earned)}</span>
          </div>

          {/* Binary tree stats */}
          <div className="border-t border-white/10 pt-1.5 space-y-1">
            <p className="text-[10px] text-white/40 uppercase tracking-wide">Binary Stats</p>
            <div className="flex justify-between text-[10px]">
              <span className="text-white/50">Left / Right</span>
              <span className="text-white">{node.left_count} / {node.right_count}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-white/50">Pkg Pts Value</span>
              <span className="text-[#C9A84C]">{node.pairing_bonus_value} pts</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-white/50">Left Points</span>
              <span className="text-[#2563eb]">{node.left_points} pts</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-white/50">Right Points</span>
              <span className="text-[#9a6f1e]">{node.right_points} pts</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-white/50">Carry Over</span>
              <span className={node.pending_pairing_balance > 0 ? 'text-[#C9A84C]' : 'text-white/30'}>
                {node.pending_pairing_balance} pts
              </span>
            </div>
          </div>
        </div>
      )}
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
function TreeLevel({ node, isRoot, onNavigate }: { node: TreeNode; isRoot?: boolean; onNavigate?: (userId: string) => void }) {
  const hasLeft      = !!node.left_child
  const hasRight     = !!node.right_child
  const showChildren = hasLeft || hasRight || node.depth < 3

  return (
    <div className="flex flex-col items-center">
      <NodeCard node={node} isRoot={isRoot} onNavigate={onNavigate} />
      {showChildren && <Connector hasLeft={hasLeft || node.depth < 3} hasRight={hasRight || node.depth < 3} />}
      {showChildren && (
        <div className="flex gap-6 items-start">
          <div className="flex flex-col items-center">
            {node.left_child  ? <TreeLevel node={node.left_child}  onNavigate={onNavigate} /> : <EmptySlot />}
          </div>
          <div className="flex flex-col items-center">
            {node.right_child ? <TreeLevel node={node.right_child} onNavigate={onNavigate} /> : <EmptySlot />}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──
export default function ResellerTreePage() {
  const [tree, setTree]       = useState<TreeNode | null>(null)
  const [meta, setMeta]       = useState<TreeMeta | null>(null)
  const [earnings, setEarnings] = useState<MyEarnings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [depth, setDepth]     = useState(4)
  const [rootUserId, setRootUserId] = useState<string | null>(null)

  const fetchTree = useCallback((d: number) => {
    setLoading(true); setError('')
    const params = new URLSearchParams({ depth: String(d) })
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
  }, [])

  useEffect(() => { fetchTree(depth) }, [depth, rootUserId, fetchTree])

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Binary Tree</h1>
          <p className="text-sm text-gray-400 mt-0.5">Hover any node to see earnings breakdown</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Depth:</span>
          {[2, 3, 4, 5, 6, 8, 10].map((d) => (
            <button key={d} onClick={() => setDepth(d)}
              className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                depth === d ? 'bg-[#0D1B3E] text-white' : 'bg-white text-gray-400 border border-[#0D1B3E]/10 hover:text-[#0D1B3E]'
              }`}>
              {d}
            </button>
          ))}
          <input
            type="number" min={1} max={20} value={depth}
            onChange={(e) => setDepth(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
            className="w-14 h-8 rounded-lg text-xs text-center border border-[#0D1B3E]/10 outline-none focus:border-[#C9A84C] text-[#0D1B3E]"
            title="Custom depth"
          />
          {rootUserId && (
            <button onClick={() => setRootUserId(null)}
              className="h-8 px-3 rounded-lg text-xs bg-[#fdecea] text-[#a03030] hover:bg-[#fcd9d9] transition-colors font-medium">
              ← My Tree
            </button>
          )}
        </div>
      </div>

      {/* My Earnings */}
      {earnings && (
        <div className="space-y-3 mb-6">

          {/* Wallet cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Wallet Balance',   value: fmt(earnings.wallet_balance),          color: '#1a7a4a' },
              { label: 'Total Earned',     value: fmt(earnings.total_earned),            color: '#0D1B3E' },
              { label: 'Total Withdrawn',  value: fmt(earnings.total_withdrawn),         color: '#a03030' },
              { label: 'Carry Over',       value: `${earnings.pending_pairing_balance} pts`, color: '#C9A84C', sub: 'Remaining binary pts' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.color}` }}>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className="text-xl font-semibold" style={{ color: s.color }}>{s.value}</p>
                {'sub' in s && s.sub && <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>}
              </div>
            ))}
          </div>

          {/* Earnings breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Direct Referral',    value: fmt(earnings.direct_referral), color: '#C9A84C',  sub: 'Sponsoring bonus',         icon: '👥' },
              { label: 'Binary Pairing',     value: fmt(earnings.binary_pairing),  color: '#1a7a4a',  sub: 'Registration pairings',    icon: '🔗' },
              { label: 'Product Points',     value: fmt(earnings.product_points),  color: '#2563eb',  sub: 'Product sales pairings',   icon: '📦' },
              { label: 'Pairing Points',     value: `${earnings.total_points.toLocaleString()} pts`, color: '#9a6f1e', sub: `≈ ${fmt(earnings.total_points * 0.50)}`, icon: '⭐' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.color}` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">{s.icon}</span>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{s.label}</p>
                </div>
                <p className="text-xl font-semibold" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leg + position summary */}
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
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-[#0D1B3E] border-2 border-[#C9A84C]" />
          <span className="text-xs text-gray-400">You</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-white border-2 border-[#0D1B3E]/10" />
          <span className="text-xs text-gray-400">Downline</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-[#F8F9FC] border-2 border-dashed border-[#0D1B3E]/15" />
          <span className="text-xs text-gray-400">Open slot</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#1a7a4a]" />
          <span className="text-xs text-gray-400">Has earnings</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] bg-[#e8f7ef] text-[#1a7a4a] px-1.5 py-0.5 rounded-full font-medium">B:₱X</span>
          <span className="text-xs text-gray-400">Binary pairing</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] bg-[#f0f7ff] text-[#2563eb] px-1.5 py-0.5 rounded-full font-medium">P:₱X</span>
          <span className="text-xs text-gray-400">Product points</span>
        </div>
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
            <TreeLevel node={tree} isRoot onNavigate={(uid) => setRootUserId(uid)} />
          </div>
        ) : (
          <p className="text-center text-gray-400 text-sm py-16">No tree data found.</p>
        )}
      </div>

    </div>
  )
}