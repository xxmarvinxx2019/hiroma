'use client'

import { useState, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

interface ReportData {
  network: {
    totalResellers: number
    activeResellers: number
    suspendedResellers: number
    totalDistributors: number
    regionalCount: number
    provincialCount: number
    cityCount: number
  }
  financial: {
    totalWalletBalance: number
    totalEarned: number
    totalWithdrawn: number
    totalPendingPayouts: number
    totalPendingAmount: number
    totalPinRevenue: number
    totalCommissionsPaid: number
  }
  mlm: {
    totalCommissions: number
    directReferralCount: number
    binaryPairingCount: number
    multilevelCount: number
    sponsorPointCount: number
    totalPointsEarned: number
    totalOverflowCount: number
  }
  catalog: {
    totalProducts: number
    physicalProducts: number
    digitalProducts: number
    totalPackages: number
    totalPinsGenerated: number
    unusedPins: number
    usedPins: number
  }
}

// ============================================================
// SECTION COMPONENT
// ============================================================

function ReportSection({
  title,
  icon,
  items,
}: {
  title: string
  icon: string
  items: { label: string; value: string | number; highlight?: boolean }[]
}) {
  return (
    <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
      <div className="bg-[#0D1B3E] px-4 py-3 flex items-center gap-2">
        <span>{icon}</span>
        <h2 className="text-white font-semibold text-sm">{title}</h2>
      </div>
      <div className="p-4">
        <div className="flex flex-col gap-0">
          {items.map((item, i) => (
            <div
              key={item.label}
              className={`flex justify-between items-center py-2.5 ${
                i < items.length - 1 ? 'border-b border-[#0D1B3E]/5' : ''
              }`}
            >
              <span className="text-xs text-gray-400">{item.label}</span>
              <span className={`text-xs font-semibold ${
                item.highlight ? 'text-[#C9A84C]' : 'text-[#0D1B3E]'
              }`}>
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generatedAt, setGeneratedAt] = useState<string>('')

  const fetchReport = () => {
    setLoading(true)
    fetch('/api/admin/reports')
      .then((r) => r.json())
      .then((d) => {
        setData(d.report)
        setGeneratedAt(new Date().toLocaleString('en-PH'))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchReport() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Generating report...</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Reports</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Full network overview — generated {generatedAt}
          </p>
        </div>
        <button
          onClick={fetchReport}
          className="bg-[#0D1B3E] text-white text-xs font-medium rounded-lg px-4 py-2 hover:bg-[#1A2F5E] transition-colors"
        >
          ↻ Refresh report
        </button>
      </div>

      {/* Top KPI Banner */}
      <div className="bg-[#0D1B3E] rounded-xl p-5 mb-6">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-4">Key metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total resellers', value: data.network.totalResellers.toLocaleString() },
            { label: 'Total PIN revenue', value: `₱${data.financial.totalPinRevenue.toLocaleString()}` },
            { label: 'Total commissions paid', value: `₱${data.financial.totalCommissionsPaid.toLocaleString()}` },
            { label: 'Total wallet balance', value: `₱${data.financial.totalWalletBalance.toLocaleString()}` },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-white/40 text-xs mb-1">{kpi.label}</p>
              <p className="text-[#C9A84C] text-xl font-semibold">{kpi.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Report Sections Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <ReportSection
          title="Network overview"
          icon="🌐"
          items={[
            { label: 'Total resellers', value: data.network.totalResellers.toLocaleString(), highlight: true },
            { label: 'Active resellers', value: data.network.activeResellers.toLocaleString() },
            { label: 'Suspended resellers', value: data.network.suspendedResellers.toLocaleString() },
            { label: 'Total distributors', value: data.network.totalDistributors.toLocaleString() },
            { label: 'Regional distributors', value: data.network.regionalCount.toLocaleString() },
            { label: 'Provincial distributors', value: data.network.provincialCount.toLocaleString() },
            { label: 'City distributors', value: data.network.cityCount.toLocaleString() },
          ]}
        />

        <ReportSection
          title="Financial summary"
          icon="💰"
          items={[
            { label: 'Total PIN revenue', value: `₱${data.financial.totalPinRevenue.toLocaleString()}`, highlight: true },
            { label: 'Total commissions paid', value: `₱${data.financial.totalCommissionsPaid.toLocaleString()}`, highlight: true },
            { label: 'Total wallet balance (all users)', value: `₱${data.financial.totalWalletBalance.toLocaleString()}` },
            { label: 'Total ever earned', value: `₱${data.financial.totalEarned.toLocaleString()}` },
            { label: 'Total ever withdrawn', value: `₱${data.financial.totalWithdrawn.toLocaleString()}` },
            { label: 'Pending payout requests', value: data.financial.totalPendingPayouts.toLocaleString() },
            { label: 'Pending payout amount', value: `₱${data.financial.totalPendingAmount.toLocaleString()}` },
          ]}
        />

        <ReportSection
          title="MLM commission breakdown"
          icon="🌳"
          items={[
            { label: 'Total commission records', value: data.mlm.totalCommissions.toLocaleString() },
            { label: 'Direct referral bonuses', value: data.mlm.directReferralCount.toLocaleString(), highlight: true },
            { label: 'Binary pairing bonuses', value: data.mlm.binaryPairingCount.toLocaleString(), highlight: true },
            { label: 'Multi-level bonuses', value: data.mlm.multilevelCount.toLocaleString() },
            { label: 'Sponsor point records', value: data.mlm.sponsorPointCount.toLocaleString() },
            { label: 'Total points earned', value: data.mlm.totalPointsEarned.toLocaleString() },
            { label: 'Overflow to Hiroma', value: data.mlm.totalOverflowCount.toLocaleString() },
          ]}
        />

        <ReportSection
          title="Catalog & PIN summary"
          icon="📦"
          items={[
            { label: 'Total active products', value: data.catalog.totalProducts.toLocaleString() },
            { label: 'Physical products', value: data.catalog.physicalProducts.toLocaleString() },
            { label: 'Digital products', value: data.catalog.digitalProducts.toLocaleString() },
            { label: 'Total packages', value: data.catalog.totalPackages.toLocaleString() },
            { label: 'Total PINs generated', value: data.catalog.totalPinsGenerated.toLocaleString(), highlight: true },
            { label: 'Unused PINs', value: data.catalog.unusedPins.toLocaleString() },
            { label: 'Used PINs (activated)', value: data.catalog.usedPins.toLocaleString() },
          ]}
        />

      </div>
    </div>
  )
}