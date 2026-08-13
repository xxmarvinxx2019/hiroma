import HiroAssistant from '@/app/components/hiro/HiroAssistant'

export default function HiroPage() {
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#B78922]">Smart account help</p>
        <h1 className="mt-1 text-2xl font-semibold text-[#0D1B3E]">Ask Hiro</h1>
        <p className="mt-1 text-sm text-gray-500">Ask in Bisaya, Tagalog, or English about your account and the Hiroma system.</p>
      </div>
      <HiroAssistant />
    </section>
  )
}
