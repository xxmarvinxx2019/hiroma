'use client'

import { useState, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

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
}

interface TreeMeta {
  node_id: string
  position: string | null
  left_count: number
  right_count: number
  sponsor: { username: string; full_name: string } | null
  parent: { id: string; user: { username: string; full_name: string } } | null
}

// ============================================================
// EMPTY SLOT
// ============================================================

function EmptySlot() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-[110px] border-2 border-dashed border-[#0D1B3E]/15 rounded-xl px-2 py-3 flex flex-col items-center gap-1 bg-[#F8F9FC]">
        <div className="w-8 h-8 rounded-full bg-[#0D1B3E]/8 flex items-center justify-center">
          <span className="text-gray-300 text-lg">+</span>
        </div>
        <p className="text-[10px] text-gray-300">Open slot</p>
      </div>
    </div>
  )
}

// ============================================================
// TREE NODE CARD
// ============================================================

function NodeCard({ node, isRoot }: { node: TreeNode; isRoot?: boolean }) {
  const [hovered, setHovered] = useState(false)

  const bgColor = node.is_self
    ? 'bg-[#0D1B3E] text-white'
    : 'bg-white text-[#0D1B3E]'

  const borderColor = node.is_self
    ? 'border-[#C9A84C]'
    : 'border-[#0D1B3E]/10'

  return (
    <div
      className={`relative w-[110px] border-2 ${borderColor} ${bgColor} rounded-xl px-2 py-3 flex flex-col items-center gap-1 shadow-sm cursor-pointer transition-all duration-150 ${hovered ? 'scale-105 shadow-md' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Badge */}
      {node.is_self && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#C9A84C] text-white text-[9px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
          You
        </span>
      )}

      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
        node.is_self ? 'bg-[#C9A84C] text-white' : 'bg-[#0D1B3E]/8 text-[#0D1B3E]'
      }`}>
        {node.full_name.charAt(0).toUpperCase()}
      </div>

      {/* Name */}
      <p className={`text-[10px] font-semibold text-center leading-tight truncate w-full text-center ${node.is_self ? 'text-white' : 'text-[#0D1B3E]'}`}>
        {node.full_name.split(' ')[0]}
      </p>

      {/* Username */}
      <p className={`text-[9px] truncate w-full text-center ${node.is_self ? 'text-[#C9A84C]' : 'text-gray-400'}`}>
        @{node.username}
      </p>

      {/* Package */}
      {node.package_name && (
        <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${
          node.is_self ? 'bg-white/20 text-white' : 'bg-[#0D1B3E]/8 text-[#0D1B3E]'
        }`}>
          {node.package_name}
        </span>
      )}

      {/* Position badge */}
      {node.position && !isRoot && (
        <span className={`text-[8px] px-1.5 py-0.5 rounded-full capitalize ${
          node.position === 'left'
            ? 'bg-[#f0f7ff] text-[#2563eb]'
            : 'bg-[#fef9ee] text-[#9a6f1e]'
        }`}>
          {node.position}
        </span>
      )}
    </div>
  )
}

// ============================================================
// CONNECTOR LINE
// ============================================================

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

// ============================================================
// RECURSIVE TREE RENDERER
// ============================================================

function TreeLevel({ node, isRoot }: { node: TreeNode; isRoot?: boolean }) {
  const hasLeft  = !!node.left_child
  const hasRight = !!node.right_child
  const showChildren = hasLeft || hasRight || node.depth < 3

  return (
    <div className="flex flex-col items-center">
      {/* This node */}
      <NodeCard node={node} isRoot={isRoot} />

      {/* Connector */}
      {showChildren && (
        <Connector hasLeft={hasLeft || node.depth < 3} hasRight={hasRight || node.depth < 3} />
      )}

      {/* Children row */}
      {showChildren && (
        <div className="flex gap-4 items-start">
          {/* Left */}
          <div className="flex flex-col items-center">
            {node.left_child ? (
              <TreeLevel node={node.left_child} />
            ) : (
              <EmptySlot />
            )}
          </div>

          {/* Right */}
          <div className="flex flex-col items-center">
            {node.right_child ? (
              <TreeLevel node={node.right_child} />
            ) : (
              <EmptySlot />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function ResellerTreePage() {
  const [tree, setTree]     = useState<TreeNode | null>(null)
  const [meta, setMeta]     = useState<TreeMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')
  const [depth, setDepth]   = useState(4)

  const fetchTree = (d: number) => {
    setLoading(true)
    setError('')
    fetch(`/api/reseller/tree?depth=${d}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setTree(data.tree)
        setMeta(data.meta)
      })
      .catch(() => setError('Failed to load tree.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchTree(depth) }, [depth])

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Binary Tree</h1>
          <p className="text-sm text-gray-400 mt-0.5">Your downline structure</p>
        </div>

        {/* Depth selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Levels:</span>
          <div className="flex gap-1">
            {[2, 3, 4, 5].map((d) => (
              <button key={d} onClick={() => setDepth(d)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                  depth === d ? 'bg-[#0D1B3E] text-white' : 'bg-white text-gray-400 border border-[#0D1B3E]/10 hover:text-[#0D1B3E]'
                }`}>{d}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Leg summary cards */}
      {meta && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Left Leg',  value: meta.left_count,  color: '#2563eb' },
            { label: 'Right Leg', value: meta.right_count, color: '#9a6f1e' },
            { label: 'Sponsor',   value: meta.sponsor?.full_name || '—', color: '#0D1B3E', isText: true },
            { label: 'Position',  value: meta.position ? meta.position.charAt(0).toUpperCase() + meta.position.slice(1) : '—', color: '#C9A84C', isText: true },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
              style={{ borderTop: `2px solid ${s.color}` }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
              {s.isText ? (
                <p className="text-sm font-semibold text-[#0D1B3E] truncate">{s.value}</p>
              ) : (
                <p className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4">
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
          <div className="w-3 h-3 rounded-full bg-[#f0f7ff] border border-[#2563eb]" />
          <span className="text-xs text-gray-400">Left</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#fef9ee] border border-[#9a6f1e]" />
          <span className="text-xs text-gray-400">Right</span>
        </div>
      </div>

      {/* Tree */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-6 overflow-x-auto">
        {loading ? (
          <div className="flex flex-col items-center py-16">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mb-2" />
            <p className="text-gray-400 text-sm">Loading tree...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-16">
            <p className="text-[#a03030] text-sm">{error}</p>
          </div>
        ) : tree ? (
          <div className="flex justify-center min-w-max mx-auto">
            <TreeLevel node={tree} isRoot />
          </div>
        ) : (
          <div className="flex flex-col items-center py-16">
            <p className="text-gray-400 text-sm">No tree data found.</p>
          </div>
        )}
      </div>

    </div>
  )
}