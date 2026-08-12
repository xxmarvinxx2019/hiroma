import { notFound } from 'next/navigation'

const SCENARIOS: Record<string, string> = {
  'direct-referral': 'Direct Referral',
  'binary-commission': 'Binary Commission',
  'product-binary': 'Product Binary',
  'ranking-engine': 'Ranking Engine',
  'reserve-ledger': 'Reserve Ledger',
  'payout-ledger': 'Payout Ledger',
  'flushout-report': 'Flushout Report',
}

export default async function CommissionTestingScenarioPage({
  params,
}: {
  params: Promise<{ scenario: string }>
}) {
  const { scenario } = await params
  const title = SCENARIOS[scenario]

  if (!title) notFound()

  return (
    <main className="mx-auto w-full max-w-5xl p-6 sm:p-8">
      <div className="rounded-2xl border border-[#0D1B3E]/10 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">Commission testing</p>
        <h1 className="mt-2 text-2xl font-bold text-[#0D1B3E]">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
          This is the dedicated testing workspace for {title.toLowerCase()} scenarios. It does not change live commission, payout, PIN, or financial records.
        </p>
      </div>
    </main>
  )
}
