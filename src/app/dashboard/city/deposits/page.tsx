import DepositReconciliationPanel from '../reports/DepositReconciliationPanel'

export default function BranchDepositsPage() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-[#9a741d]">
          Cash control
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-[#0D1B3E]">
          Bank Deposits
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Submit branch deposits, independently confirm the official bank record,
          and respond to Area Manager findings. Full cost and profit reports remain
          restricted to authorized report viewers.
        </p>
      </header>
      <DepositReconciliationPanel />
    </div>
  )
}
