'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'

type NetworkNode = {
  id: string
  user_id: string
  parent_id: string | null
  parent_user_id: string | null
  parent_username: string | null
  position: string | null
  depth: number
  member_id: string
  username: string
  full_name: string
  status: string
  created_at: string
  package_name: string | null
  rank: string | null
  left_count: number
  right_count: number
  left_points: number
  right_points: number
  sponsor_id: string | null
  sponsor_username: string | null
  sponsor_name: string | null
  left_child: NetworkNode | null
  right_child: NetworkNode | null
}

type SearchResult = Pick<NetworkNode, 'user_id' | 'member_id' | 'username' | 'full_name' | 'status' | 'package_name' | 'rank' | 'position' | 'left_count' | 'right_count'>

type NetworkResponse = {
  tree: NetworkNode
  depth: number
  summary: { total_nodes: number; active_nodes: number; inactive_nodes: number; extra_roots: number; unplaced_resellers: number }
}

const number = new Intl.NumberFormat('en-PH')

function NetworkCard({ node, onSelect }: { node: NetworkNode; onSelect: (userId: string) => void }) {
  const active = node.status === 'active'
  return (
    <article className="mx-auto w-64 overflow-hidden rounded-2xl border border-[#0D1B3E]/15 bg-white shadow-sm">
      <div className={`h-1.5 ${node.position === 'left' ? 'bg-blue-500' : node.position === 'right' ? 'bg-amber-500' : 'bg-[#0D1B3E]'}`} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[#0D1B3E]">{node.full_name}</p>
            <p className="truncate text-xs text-slate-500">@{node.username} · {node.member_id}</p>
          </div>
          <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{node.status}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-slate-50 p-2"><span className="block text-slate-400">Package</span><b className="block truncate text-[#0D1B3E]">{node.package_name || 'No package'}</b></div>
          <div className="rounded-lg bg-slate-50 p-2"><span className="block text-slate-400">Position</span><b className="capitalize text-[#0D1B3E]">{node.position || 'Network root'}</b></div>
          <div className="rounded-lg bg-blue-50 p-2"><span className="text-blue-500">Left leg</span><b className="block text-blue-800">{number.format(node.left_count)}</b></div>
          <div className="rounded-lg bg-amber-50 p-2"><span className="text-amber-600">Right leg</span><b className="block text-amber-800">{number.format(node.right_count)}</b></div>
        </div>
        <dl className="mt-3 space-y-1 text-[10px] text-slate-500">
          <div className="flex gap-1"><dt className="font-semibold">Sponsor:</dt><dd className="truncate">{node.sponsor_username ? `@${node.sponsor_username}` : 'None / root'}</dd></div>
          <div className="flex gap-1"><dt className="font-semibold">Binary parent:</dt><dd className="truncate">{node.parent_username ? `@${node.parent_username}` : 'None / root'}</dd></div>
          <div className="flex gap-1"><dt className="font-semibold">Points:</dt><dd>{number.format(node.left_points)} L · {number.format(node.right_points)} R</dd></div>
        </dl>
        <button type="button" onClick={() => onSelect(node.user_id)} className="mt-3 w-full rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-[11px] font-semibold text-[#0D1B3E] hover:bg-slate-50">View as tree root</button>
      </div>
    </article>
  )
}

function NetworkBranch({ node, onSelect }: { node: NetworkNode; onSelect: (userId: string) => void }) {
  const hasChildren = Boolean(node.left_child || node.right_child)
  return (
    <div className="flex min-w-max flex-col items-center">
      <NetworkCard node={node} onSelect={onSelect} />
      {hasChildren && <>
        <div className="h-6 w-px bg-[#0D1B3E]/25" />
        <div className="grid grid-cols-2 gap-8 border-t border-[#0D1B3E]/20 pt-6 md:gap-12">
          <div className="min-w-64">{node.left_child ? <NetworkBranch node={node.left_child} onSelect={onSelect} /> : <EmptyPosition label="Left position is open" />}</div>
          <div className="min-w-64">{node.right_child ? <NetworkBranch node={node.right_child} onSelect={onSelect} /> : <EmptyPosition label="Right position is open" />}</div>
        </div>
      </>}
    </div>
  )
}

function EmptyPosition({ label }: { label: string }) {
  return <div className="mx-auto w-52 rounded-xl border border-dashed border-slate-300 bg-white/60 p-5 text-center text-xs text-slate-400">{label}</div>
}

export default function AdminNetworkPage() {
  const [data, setData] = useState<NetworkResponse | null>(null)
  const [depth, setDepth] = useState(2)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])

  const loadTree = useCallback(async (rootUserId = '', nextDepth = depth) => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ depth: String(nextDepth) })
    if (rootUserId) params.set('root_user_id', rootUserId)
    try {
      const response = await fetch(`/api/admin/network?${params.toString()}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load the binary network.')
      setData(payload)
      setDepth(nextDepth)
      setResults([])
      setSearch('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the binary network.')
    } finally {
      setLoading(false)
    }
  }, [depth])

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/network?depth=2', { cache: 'no-store' })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return
        if (!response.ok) throw new Error(payload.error || 'Unable to load the binary network.')
        setData(payload)
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load the binary network.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const searchNetwork = async (event: FormEvent) => {
    event.preventDefault()
    const query = search.trim()
    if (query.length < 2) { setError('Enter at least two characters to search.'); return }
    setSearching(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/network?search=${encodeURIComponent(query)}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to search the network.')
      setResults(payload.results || [])
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Unable to search the network.')
    } finally {
      setSearching(false)
    }
  }

  const summary = data?.summary
  return (
    <main className="mx-auto max-w-[1700px] p-4 text-[#0D1B3E] md:p-6">
      <header className="flex flex-col gap-4 border-b border-[#0D1B3E]/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#C9A84C]">MLM network administration</p><h1 className="mt-1 text-2xl font-bold">Binary Network</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">Search and audit sponsor relationships, binary placements, and left/right network structure. This explorer is read-only.</p></div>
        <form onSubmit={searchNetwork} className="flex w-full max-w-xl gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, username, or Member ID" className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2.5 text-sm" /><button disabled={searching} className="rounded-lg bg-[#0D1B3E] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{searching ? 'Searching…' : 'Search network'}</button></form>
      </header>

      {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {results.length > 0 && <section className="mt-4 overflow-hidden rounded-2xl border bg-white"><div className="border-b p-4"><h2 className="font-bold">Search results</h2><p className="text-xs text-slate-500">Select a member to inspect that part of the binary network.</p></div><div className="divide-y">{results.map((result) => <button type="button" key={result.user_id} onClick={() => void loadTree(result.user_id)} className="grid w-full gap-2 px-4 py-3 text-left hover:bg-slate-50 sm:grid-cols-[minmax(220px,1fr)_180px_120px_130px]"><span><b className="block text-sm">{result.full_name}</b><small className="text-slate-500">@{result.username} · {result.member_id}</small></span><span className="text-xs text-slate-500"><small className="block">Package</small><b className="text-[#0D1B3E]">{result.package_name || 'No package'}</b></span><span className="text-xs capitalize text-slate-500"><small className="block">Position</small><b className="text-[#0D1B3E]">{result.position || 'Root'}</b></span><span className="text-xs text-slate-500"><small className="block">Network</small><b className="text-[#0D1B3E]">{result.left_count} L · {result.right_count} R</b></span></button>)}</div></section>}

      {summary && <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
        ['Total tree accounts', summary.total_nodes, 'All accounts with binary placement', '#2563eb'],
        ['Active', summary.active_nodes, 'Active accounts in the tree', '#059669'],
        ['Inactive', summary.inactive_nodes, 'Inactive or deactivated accounts', '#dc2626'],
        ['Unplaced resellers', summary.unplaced_resellers, 'Resellers without a tree node', '#d97706'],
        ['Additional roots', summary.extra_roots, 'Should normally remain zero', '#7c3aed'],
      ].map(([label, value, note, accent]) => <div key={String(label)} className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderTop: `4px solid ${accent}` }}><p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{number.format(Number(value))}</p><p className="mt-1 text-xs text-slate-400">{note}</p></div>)}</section>}

      <section className="mt-5 overflow-hidden rounded-2xl border bg-[#F7F8FC]">
        <div className="flex flex-col gap-3 border-b bg-white p-4 sm:flex-row sm:items-center"><div className="mr-auto"><h2 className="font-bold">Binary placement explorer</h2><p className="text-xs text-slate-500">Blue = left placement · Gold = right placement. Sponsor and binary parent may be different.</p></div><label className="text-xs text-slate-500">Visible levels<select value={depth} onChange={(event) => void loadTree(data?.tree.user_id || '', Number(event.target.value))} className="ml-2 rounded-lg border bg-white px-3 py-2 text-sm"><option value={1}>2 levels</option><option value={2}>3 levels</option><option value={3}>4 levels</option></select></label>{data?.tree.parent_user_id && <button type="button" onClick={() => void loadTree(data.tree.parent_user_id!)} className="rounded-lg border px-3 py-2 text-xs font-semibold">View parent</button>}<button type="button" onClick={() => void loadTree('', depth)} className="rounded-lg bg-[#0D1B3E] px-3 py-2 text-xs font-semibold text-white">Back to network root</button></div>
        <div className="overflow-x-auto p-8">{loading ? <div className="py-24 text-center text-sm text-slate-400">Loading binary network…</div> : data?.tree ? <NetworkBranch node={data.tree} onSelect={(userId) => void loadTree(userId)} /> : <div className="py-24 text-center text-sm text-slate-400">No binary network data available.</div>}</div>
        <div className="border-t bg-blue-50 p-4 text-xs text-blue-900"><b>Read-only safeguard:</b> this page does not move members or recalculate commissions. Any future placement-correction workflow must require a Security PIN, reason, impact preview, and audit record.</div>
      </section>
    </main>
  )
}
