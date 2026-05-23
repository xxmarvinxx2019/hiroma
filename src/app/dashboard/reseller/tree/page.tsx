'use client'

import { useState, useEffect } from 'react'

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
  pairing_bonus_value:     number
  pending_pairing_balance: number
  left_points:             number
  right_points:            number
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

const fmt = (n: number) => `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function EmptySlot() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-[120px] border-2 border-dashed border-[#0D1B3E]/15 rounded-xl px-2 py-3 flex flex-col items-center gap-1 bg-[#F8F9FC]">
        <div className="w-8 h-8 rounded-full bg-[#0D1B3E]/8 flex items-center justify-center">
          <span className="text-gray-300 text-lg">+</span>
        </div>
        <p className="text-[10px] text-gray-300">Open slot</p>
      </div>
    </div>
  )
}

function NodeCard({ node, isRoot }: { node: TreeNode; isRoot?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const bgColor     = node.is_self ? 'bg-[#0D1B3E] text-white' : 'bg-white text-[#0D1B3E]'
  const borderColor = node.is_self ? 'border-[#C9A84C]' : 'border-[#0D1B3E]/10'
  const hasEarnings = node.total_earned > 0

  return (
    <div className="relative flex flex-col items-center">
      <div
        className={`relative w-[120px] border-2 ${borderColor} ${bgColor} rounded-xl px-2 py-3 flex flex-col items-center gap-1 shadow-sm cursor-pointer transition-all duration-150 ${hovered ? 'scale-105 shadow-md' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {node.is_self && (
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#C9A84C] text-white text-[9px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap">You</span>
        )}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${node.is_self ? 'bg-[#C9A84C] text-white' : 'bg-[#0D1B3E]/8 text-[#0D1B3E]'}`}>
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
        {node.position && !isRoot && (
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full capitalize ${node.position === 'left' ? 'bg-[#f0f7ff] text-[#2563eb]' : 'bg-[#fef9ee] text-[#9a6f1e]'}`}>
            {node.position}
          </span>
        )}
        <div className="flex gap-1 mt-0.5">
          <span className="text-[8px] text-[#2563eb]">L:{node.left_count}</span>
          <span className="text-[8px] text-gray-300">·</span>
          <span className="text-[8px] text-[#9a6f1e]">R:{node.right_count}</span>
        </div>
        {hasEarnings && (
          <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[#1a7a4a] rounded-full border-2 border-white" />
        )}
      </div>

      {hovered && (
        <div className="absolute top-full mt-2 z-50 bg-[#0D1B3E] text-white rounded-xl shadow-xl p-3 w-52 text-xs space-y-1.5"
          style={{ left: '50%', transform: 'translateX(-50%)' }}>
          <p className="font-semibold text-[#C9A84C] border-b border-white/10 pb-1.5 mb-1.5">{node.full_name}</p>
          <div className="flex justify-between">
            <span className="text-white/60">Direct Referral</span>
            <span className="text-[#C9A84C]">{fmt(node.direct_referral_earned)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/60">Binary Pairing</span>
            <span className="text-[#1a7a4a]">{fmt(node.binary_pairing_earned)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/60">Product Points</span>
            <span className="text-[#2563eb]">{fmt(node.product_points_earned)}</span>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-1.5 font-semibold">
            <span>Total Earned</span>
            <span>{fmt(node.total_earned)}</span>
          </div>
          <div className="flex justify-between text-[10px] text-white/40">
            <span>Left / Right</span>
            <span>{node.left_count} / {node.right_count}</span>
          </div>
          <div className="border-t border-white/10 pt-1 mt-1 space-y-1">
            <div className="flex justify-between text-[10px] text-white/40">
              <span>Binary Pts Value</span>
              <span className="text-[#C9A84C]">{node.pairing_bonus_value} pts</span>
            </div>
            <div className="flex justify-between text-[10px] text-white/40">
              <span>Left Points</span>
              <span className="text-[#2563eb]">{node.left_points} pts</span>
            </div>
            <div className="flex justify-between text-[10px] text-white/40">
              <span>Right Points</span>
              <span className="text-[#2563eb]">{node.right_points} pts</span>
            </div>
            <div className="flex justify-between text-[10px] text-white/40">
              <span>Carry Over</span>
              <span className={node.pending_pairing_balance > 0 ? 'text-[#9a6f1e]' : 'text-white/40'}>
                {node.pending_pairing_balance} pts
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Connector({ hasLeft, hasRight }: { hasLeft: boolean; hasRight: boolean }) {
  if (!hasLeft && !hasRight) return null
  return (
    <div className="flex justify-center w-full my-0">
      <div className="relative flex items-start justify-center w-full max-w-[300px]">
        <div className="absolute top-0 left-1/2 w-px h-4 bg-[#0D1B3E]/15 -translate-x-1/2" />
        <div className="absolute top-4 left-[25%] right-[25%] h-px bg-[#0D1B3E]/15" />
        {hasLeft  && <div className="absolute top-4 left-[25%]  w-px h-4 bg-[#0D1B3E]/15" />}
        {hasRight && <div className="absolute top-4 right-[25%] w-px h-4 bg-[#0D1B3E]/15" />}
        <div className="h-8" />
      </div>
    </div>
  )
}

function TreeLevel({ node, isRoot }: { node: TreeNode; isRoot?: boolean }) {
  const hasLeft      = !!node.left_child
  const hasRight     = !!node.right_child
  const showChildren = hasLeft || hasRight || node.depth < 3

  return (
    <div className="flex flex-col items-center">
      <NodeCard node={node} isRoot={isRoot} />
      {showChildren && <Connector hasLeft={hasLeft || node.depth < 3} hasRight={hasRight || node.depth < 3} />}
      {showChildren && (
        <div className="flex gap-4 items-start">
          <div className="flex flex-col items-center">
            {node.left_child ? <TreeLevel node={node.left_child} /> : <EmptySlot />}
          </div>
          <div className="flex flex-col items-center">
            {node.right_child ? <TreeLevel node={node.right_child} /> : <EmptySlot />}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ResellerTreePage() {
  const [tree, setTree]       = useState<TreeNode | null>(null)
  const [meta, setMeta]       = useState<TreeMeta | null>(null)
  const [earnings, setEarnings] = useState<MyEarnings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [depth, setDepth]     = useState(4)

  const fetchTree = (d: number) => {
    setLoading(true); setError('')
    fetch(`/api/reseller/tree?depth=${d}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setTree(data.tree)
        setMeta(data.meta)
        setEarnings(data.my_earnings)
      })
      .catch(() => setError('Failed to load tree.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchTree(depth) }, [depth])

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Binary Tree</h1>
          <p className="text-sm text-gray-400 mt-0.5">Hover any node to see their earnings breakdown</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Levels:</span>
          {[2, 3, 4, 5].map((d) => (
            <button key={d} onClick={() => setDepth(d)}
              className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${depth === d ? 'bg-[#0D1B3E] text-white' : 'bg-white text-gray-400 border border-[#0D1B3E]/10 hover:text-[#0D1B3E]'}`}>
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* My Earnings */}
      {earnings && (
        <div className="space-y-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Wallet Balance',  value: fmt(earnings.wallet_balance),          accent: '#1a7a4a' },
              { label: 'Total Earned',    value: fmt(earnings.total_earned),            accent: '#2563eb' },
              { label: 'Total Withdrawn', value: fmt(earnings.total_withdrawn),         accent: '#e05252' },
              { label: 'Pending Balance', value: fmt(earnings.pending_pairing_balance), accent: '#C9A84C', sub: 'Pairing remainder' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.accent}` }}>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className="text-xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
                {'sub' in s && s.sub && <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Direct Referral Bonus', value: fmt(earnings.direct_referral), accent: '#C9A84C', sub: 'From sponsoring' },
              { label: 'Binary Pairing Bonus',  value: fmt(earnings.binary_pairing),  accent: '#1a7a4a', sub: 'From pairings' },
              { label: 'Product Points Bonus',  value: fmt(earnings.product_points),  accent: '#2563eb', sub: 'From product points' },
              { label: 'Total Points',          value: `${earnings.total_points.toLocaleString()} pts`, accent: '#9a6f1e', sub: 'Sponsor points accumulated' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.accent}` }}>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className="text-xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leg summary */}
      {meta && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Left Leg',  value: String(meta.left_count),  color: '#2563eb', isText: false },
            { label: 'Right Leg', value: String(meta.right_count), color: '#9a6f1e', isText: false },
            { label: 'Sponsor',   value: meta.sponsor?.full_name || '—', color: '#0D1B3E', isText: true },
            { label: 'Position',  value: meta.position ? meta.position.charAt(0).toUpperCase() + meta.position.slice(1) : '—', color: '#C9A84C', isText: true },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.color}` }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
              {s.isText
                ? <p className="text-sm font-semibold text-[#0D1B3E] truncate">{s.value}</p>
                : <p className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</p>
              }
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        {[
          { bg: 'bg-[#0D1B3E] border-[#C9A84C]', label: 'You', border: 'border-2' },
          { bg: 'bg-white border-[#0D1B3E]/10', label: 'Downline', border: 'border-2' },
          { bg: 'bg-[#F8F9FC] border-dashed border-[#0D1B3E]/15', label: 'Open slot', border: 'border-2' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className={`w-4 h-4 rounded ${l.bg} ${l.border}`} />
            <span className="text-xs text-gray-400">{l.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#1a7a4a]" />
          <span className="text-xs text-gray-400">Has earnings</span>
        </div>
        <span className="text-xs text-gray-300">· Hover any node to see earnings</span>
      </div>

      {/* Tree */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-6 overflow-x-auto">
        {loading ? (
          <div className="flex flex-col items-center py-16">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mb-2" />
            <p className="text-gray-400 text-sm">Loading tree...</p>
          </div>
        ) : error ? (
          <p className="text-center text-[#a03030] text-sm py-16">{error}</p>
        ) : tree ? (
          <div className="flex justify-center min-w-max mx-auto">
            <TreeLevel node={tree} isRoot />
          </div>
        ) : (
          <p className="text-center text-gray-400 text-sm py-16">No tree data found.</p>
        )}
      </div>
    </div>
  )
}