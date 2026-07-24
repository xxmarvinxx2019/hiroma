'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

interface AuditLog {
  id:            string
  user_id:       string | null
  user_name:     string | null
  user_role:     string | null
  member_id:     string | null
  activity_type: string
  category:      string
  description:   string
  metadata:      Record<string, any>
  ip_address:    string | null
  device:        string | null
  risk_level:    string
  status:        string
  created_at:    string
}

interface Summary {
  total_today:        number
  failed_logins:      number
  suspicious:         number
  duplicates:         number
  admin_actions:      number
  wallet_adjustments: number
}

const RISK_STYLES: Record<string, string> = {
  low:      'bg-[#e8f7ef] text-[#1a7a4a]',
  warning:  'bg-[#fff8e6] text-[#b87a00]',
  medium:   'bg-[#fff0e6] text-[#c25e00]',
  high:     'bg-[#fdecea] text-[#e05252]',
  critical: 'bg-[#2d0a0a] text-white',
}

const STATUS_STYLES: Record<string, string> = {
  normal:       'bg-[#e8f7ef] text-[#1a7a4a]',
  suspicious:   'bg-[#fdecea] text-[#e05252]',
  duplicate:    'bg-[#f3e8ff] text-[#7c3aed]',
  under_review: 'bg-[#fff8e6] text-[#b87a00]',
  completed:    'bg-[#eef0f8] text-[#0D1B3E]',
  failed:       'bg-[#fdecea] text-[#a03030]',
}

const CATEGORY_ICONS: Record<string, string> = {
  auth:        '🔐',
  order:       '🛒',
  commission:  '💰',
  wallet:      '👛',
  admin:       '⚙️',
  pin:         '🔑',
  reseller:    '👤',
  payout:      '💸',
  product:     '📦',
  distributor: '🏢',
}

const DEVICE_ICONS: Record<string, string> = {
  iPhone:  '📱',
  Android: '📱',
  Windows: '🖥️',
  Mac:     '🖥️',
  Linux:   '🖥️',
  Unknown: '❓',
}

function timeAgo(date: string) {
  const diff = Math.floor((Date.now() - new Date(date + (date.endsWith('Z') ? '' : 'Z')).getTime()) / 1000)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

const PAGE_SIZE = 15

export default function AuditLogPage() {
  const [logs, setLogs]               = useState<AuditLog[]>([])
  const [summary, setSummary]         = useState<Summary>({ total_today: 0, failed_logins: 0, suspicious: 0, duplicates: 0, admin_actions: 0, wallet_adjustments: 0 })
  const [suspicious, setSuspicious]   = useState<any[]>([])
  const [meta, setMeta]               = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]         = useState(true)
  const [page, setPage]               = useState(1)
  const [search, setSearch]           = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [category, setCategory]       = useState('all')
  const [riskLevel, setRiskLevel]     = useState('all')
  const [userType, setUserType]       = useState('all')
  const getLocalDate = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  const [dateFrom, setDateFrom]       = useState(getLocalDate)
  const [dateTo, setDateTo]           = useState(getLocalDate)
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  useEffect(() => { const t = setTimeout(() => setSearch(searchInput), 400); return () => clearTimeout(t) }, [searchInput])
  useEffect(() => { setPage(1) }, [search, category, riskLevel, userType, dateFrom, dateTo])

  const fetchLogs = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), pageSize: String(PAGE_SIZE),
      search, category, risk: riskLevel, userType,
      from: dateFrom, to: dateTo,
    })
    fetch(`/api/admin/audit-logs?${params}`)
      .then(r => r.json())
      .then(d => {
        setLogs(d.logs || [])
        setSummary({
          total_today:        Number(d.summary?.total_today        || 0),
          failed_logins:      Number(d.summary?.failed_logins      || 0),
          suspicious:         Number(d.summary?.suspicious         || 0),
          duplicates:         Number(d.summary?.duplicates         || 0),
          admin_actions:      Number(d.summary?.admin_actions      || 0),
          wallet_adjustments: Number(d.summary?.wallet_adjustments || 0),
        })
        setSuspicious(d.suspicious_activities || [])
        setMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
      })
      .finally(() => setLoading(false))
  }, [page, search, category, riskLevel, userType, dateFrom, dateTo])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const exportCSV = () => {
    const headers = ['Time', 'User', 'Member ID', 'Role', 'Activity', 'Description', 'IP Address', 'Device', 'Risk Level', 'Status']
    const rows    = logs.map(l => [
      new Date(l.created_at).toLocaleString('en-PH'),
      l.user_name || '—', l.member_id || '—', l.user_role || '—',
      l.activity_type, l.description,
      l.ip_address || '—', l.device || '—',
      l.risk_level, l.status,
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const a   = document.createElement('a')
    a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `audit-log-${dateFrom}.csv`
    a.click()
  }

  return (
    <div className="w-full space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#0D1B3E]">Audit Log Center</h1>
        <p className="text-xs text-gray-400 mt-0.5">Track all system activities of members, resellers, distributors and admins.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Today's Activities", value: summary.total_today,        color: '#2563eb', icon: '📋' },
          { label: 'Failed Logins',      value: summary.failed_logins,      color: '#e05252', icon: '🔒' },
          { label: 'Suspicious',         value: summary.suspicious,         color: '#f59e0b', icon: '⚠️' },
          { label: 'Duplicate Entries',  value: summary.duplicates,         color: '#7c3aed', icon: '📋' },
          { label: 'Admin Actions',      value: summary.admin_actions,      color: '#0D1B3E', icon: '⚙️' },
          { label: 'Wallet Adjustments', value: summary.wallet_adjustments, color: '#1a7a4a', icon: '👛' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm transition-all" style={{ borderTop: `2px solid ${s.color}` }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] text-gray-400 uppercase tracking-wide font-semibold leading-tight">{s.label}</p>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ backgroundColor: s.color + '15' }}>{s.icon}</div>
            </div>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Main Log Table */}
        <div className="xl:col-span-3 space-y-4">
          {/* Filters */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Search */}
              <div className="md:col-span-2 flex items-center gap-2 bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-xl px-3 py-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-300 flex-shrink-0">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                  placeholder="Search by username, member ID, description..."
                  className="flex-1 bg-transparent text-xs text-[#0D1B3E] outline-none placeholder:text-gray-300" />
              </div>

              {/* User Type */}
              <select value={userType} onChange={e => setUserType(e.target.value)}
                className="text-xs border border-[#0D1B3E]/10 rounded-xl px-3 py-2 bg-[#f8f9fc] text-[#0D1B3E] outline-none">
                <option value="all">All Users</option>
                <option value="admin">Admin</option>
                <option value="regional">Regional</option>
                <option value="provincial">Provincial</option>
                <option value="city">City Dist.</option>
                <option value="reseller">Reseller</option>
              </select>

              {/* Activity Type */}
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="text-xs border border-[#0D1B3E]/10 rounded-xl px-3 py-2 bg-[#f8f9fc] text-[#0D1B3E] outline-none">
                <option value="all">All Activities</option>
                <option value="auth">Auth / Login</option>
                <option value="order">Orders</option>
                <option value="commission">Commissions</option>
                <option value="wallet">Wallet</option>
                <option value="admin">Admin Actions</option>
                <option value="pin">PIN</option>
                <option value="reseller">Reseller</option>
                <option value="payout">Payouts</option>
                <option value="product">Products</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Risk Level */}
              <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)}
                className="text-xs border border-[#0D1B3E]/10 rounded-xl px-3 py-2 bg-[#f8f9fc] text-[#0D1B3E] outline-none">
                <option value="all">All Risk Levels</option>
                <option value="low">🟢 Low</option>
                <option value="warning">🟡 Warning</option>
                <option value="medium">🟠 Medium</option>
                <option value="high">🔴 High</option>
                <option value="critical">⚫ Critical</option>
              </select>

              {/* Date Range */}
              <div className="flex items-center gap-2 border border-[#0D1B3E]/10 rounded-xl px-3 py-2 bg-[#f8f9fc]">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="text-xs text-[#0D1B3E] outline-none bg-transparent" />
              </div>
              <div className="flex items-center gap-2 border border-[#0D1B3E]/10 rounded-xl px-3 py-2 bg-[#f8f9fc]">
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="text-xs text-[#0D1B3E] outline-none bg-transparent" />
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button onClick={() => { setSearch(''); setSearchInput(''); setCategory('all'); setRiskLevel('all'); setUserType('all'); setDateFrom(new Date().toISOString().slice(0,10)); setDateTo(new Date().toISOString().slice(0,10)) }}
                  className="flex-1 text-xs border border-[#0D1B3E]/15 text-gray-500 px-3 py-2 rounded-xl hover:bg-[#f8f9fc] transition-colors">
                  Reset
                </button>
                <button onClick={exportCSV}
                  className="flex-1 flex items-center justify-center gap-1 text-xs bg-[#0D1B3E] text-white px-3 py-2 rounded-xl hover:bg-[#1A2F5E] transition-colors">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export CSV
                </button>
              </div>
            </div>
          </div>

          {/* Log Table */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#0D1B3E]/8 bg-[#f8f9fc]">
              <p className="text-sm font-bold text-[#0D1B3E]">Audit Log List</p>
              <p className="text-xs text-gray-400">Showing {meta.total.toLocaleString()} activities</p>
            </div>

            {/* Column Headers */}
            <div className="grid grid-cols-8 px-5 py-2.5 bg-[#f8f9fc] border-b border-[#0D1B3E]/8 text-[10px] text-gray-400 uppercase tracking-wide font-semibold">
              <span>Time</span>
              <span className="col-span-2">User</span>
              <span>Member ID</span>
              <span>Activity</span>
              <span className="col-span-2">Description</span>
              <span>Risk / Status</span>
            </div>

            {loading ? (
              <div className="flex flex-col items-center py-16">
                <div className="w-6 h-6 border-2 border-[#0D1B3E] border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-gray-400 text-sm">Loading audit logs...</p>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center py-16">
                <span className="text-4xl mb-3">📋</span>
                <p className="text-gray-400 text-sm">No activity logs found</p>
              </div>
            ) : logs.map(log => {
              const isExpanded  = expandedId === log.id
              const isHighRisk  = ['high', 'critical'].includes(log.risk_level)
              return (
                <div key={log.id}>
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    className={`grid grid-cols-8 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors cursor-pointer items-center ${isHighRisk ? 'bg-[#fff8f8]' : ''}`}>
                    {/* Time */}
                    <div>
                      <p className="text-[10px] font-semibold text-[#0D1B3E]">
                        {new Date(log.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                      <p className="text-[9px] text-gray-400">
                        {new Date(log.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>

                    {/* User */}
                    <div className="col-span-2 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[#0D1B3E] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                        {log.user_name?.charAt(0) || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#0D1B3E] truncate">{log.user_name || 'Unknown'}</p>
                        <p className="text-[9px] text-gray-400 capitalize">{log.user_role || '—'}</p>
                      </div>
                    </div>

                    {/* Member ID */}
                    <p className="text-[10px] font-mono text-[#2563eb] font-semibold">{log.member_id || 'N/A'}</p>

                    {/* Activity */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{CATEGORY_ICONS[log.category] || '📋'}</span>
                      <p className="text-[10px] font-semibold text-[#0D1B3E] truncate capitalize">
                        {log.activity_type.replace(/_/g, ' ')}
                      </p>
                    </div>

                    {/* Description */}
                    <p className="col-span-2 text-[10px] text-gray-500 truncate pr-2">{log.description}</p>

                    {/* Risk + Status */}
                    <div className="flex flex-col gap-1">
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase w-fit ${RISK_STYLES[log.risk_level] || 'bg-gray-100 text-gray-400'}`}>
                        {log.risk_level}
                      </span>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold capitalize w-fit ${STATUS_STYLES[log.status] || 'bg-gray-100 text-gray-400'}`}>
                        {log.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  {/* Expanded Row */}
                  {isExpanded && (
                    <div className="px-5 py-4 bg-[#f8f9fc] border-b border-[#0D1B3E]/8">
                      <div className="grid grid-cols-3 gap-4 text-xs">
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">IP Address</p>
                          <p className="font-mono text-[#0D1B3E]">{log.ip_address || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Device</p>
                          <p className="text-[#0D1B3E]">{DEVICE_ICONS[log.device || ''] || '❓'} {log.device || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Category</p>
                          <p className="text-[#0D1B3E] capitalize">{CATEGORY_ICONS[log.category]} {log.category}</p>
                        </div>
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <div className="col-span-3">
                            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Metadata</p>
                            <pre className="text-[10px] bg-white border border-[#0D1B3E]/8 rounded-lg p-2 overflow-auto max-h-24 text-[#0D1B3E]">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            <div className="px-5 py-3 border-t border-[#0D1B3E]/5 flex items-center justify-between">
              <p className="text-xs text-gray-400">Showing {Math.min((page-1)*PAGE_SIZE+1, meta.total)} to {Math.min(page*PAGE_SIZE, meta.total)} of {meta.total.toLocaleString()} entries</p>
              <Pagination meta={meta} onPageChange={setPage} />
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="space-y-4">
          {/* Suspicious Activities */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/8 bg-[#f8f9fc]">
              <div className="flex items-center gap-2">
                <span className="text-base">⚠️</span>
                <p className="text-xs font-bold text-[#0D1B3E]">Suspicious Activities</p>
              </div>
            </div>
            <div className="divide-y divide-[#0D1B3E]/5">
              {suspicious.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No suspicious activity</p>
              ) : suspicious.map((s, i) => (
                <div key={i} className="px-4 py-3 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-[#0D1B3E] truncate">{s.description}</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">{s.user_name || 'Unknown'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${RISK_STYLES[s.risk_level] || ''}`}>
                      {s.risk_level}
                    </span>
                    <p className="text-[9px] text-gray-400">{timeAgo(s.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Risk Level Guide */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-4">
            <p className="text-xs font-bold text-[#0D1B3E] mb-3">Risk Level Guide</p>
            <div className="space-y-2">
              {[
                { level: 'LOW',      color: '#1a7a4a', dot: '#22c55e', desc: 'Normal activity' },
                { level: 'WARNING',  color: '#b87a00', dot: '#f59e0b', desc: 'Unusual but not critical' },
                { level: 'MEDIUM',   color: '#c25e00', dot: '#f97316', desc: 'Potential risk detected' },
                { level: 'HIGH',     color: '#e05252', dot: '#ef4444', desc: 'High risk activity' },
                { level: 'CRITICAL', color: '#7f1d1d', dot: '#1a1a1a', desc: 'Critical security threat' },
              ].map(r => (
                <div key={r.level} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: r.dot }} />
                  <span className="text-[10px] font-bold w-14" style={{ color: r.color }}>{r.level}</span>
                  <span className="text-[10px] text-gray-400">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}