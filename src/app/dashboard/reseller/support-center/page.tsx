import SupportCenterClient from '@/app/components/support/SupportCenterClient'

export default function SupportCenterPage() {
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">Help & assistance</p>
        <h1 className="mt-1 text-2xl font-semibold text-[#0D1B3E]">Support Center</h1>
        <p className="mt-1 text-sm text-gray-400">Find account, order, payout, and delivery help in one place.</p>
      </div>
      <SupportCenterClient />
    </section>
  )
}
