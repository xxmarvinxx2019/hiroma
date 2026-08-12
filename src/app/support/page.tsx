import Link from 'next/link'
import SupportRequestForm from '@/app/components/support/SupportRequestForm'

export default function PublicSupportPage() {
  return <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_12%_14%,rgba(42,92,184,0.3),transparent_30%),radial-gradient(circle_at_88%_10%,rgba(201,168,76,0.22),transparent_27%),radial-gradient(circle_at_50%_112%,rgba(36,78,163,0.3),transparent_42%),linear-gradient(135deg,#020713_0%,#07142f_48%,#030816_100%)] px-4 py-10 text-[#0D1B3E] sm:py-14">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#E8C96A]/80 to-transparent" />
      <div className="absolute -left-32 -top-28 h-[30rem] w-[30rem] rounded-full bg-[#234f9d]/20 blur-3xl" />
      <div className="absolute -right-28 top-[-8rem] h-[28rem] w-[28rem] rounded-full bg-[#C9A84C]/15 blur-3xl" />
      <div className="absolute bottom-[-15rem] left-[35%] h-[34rem] w-[34rem] rounded-full bg-[#17428f]/20 blur-3xl" />
      <div className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_center,rgba(232,201,106,0.42)_0.7px,transparent_0.9px)] [background-size:38px_38px]" />
      <div className="absolute left-1/2 top-[47%] h-[52rem] w-[52rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#E8C96A]/15 shadow-[0_0_140px_rgba(38,93,190,0.18)]" />
      <div className="absolute left-1/2 top-[47%] h-[41rem] w-[41rem] -translate-x-1/2 -translate-y-1/2 rotate-12 rounded-full border border-white/8" />
      <div className="absolute left-1/2 top-[47%] h-[31rem] w-[31rem] -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-full border border-dashed border-[#E8C96A]/20" />
      <div className="absolute left-[8%] top-[18%] h-1.5 w-1.5 rounded-full bg-[#F7E4A2] shadow-[0_0_16px_4px_rgba(247,228,162,0.5)]" />
      <div className="absolute right-[14%] top-[25%] h-1 w-1 rounded-full bg-white shadow-[0_0_14px_3px_rgba(131,181,255,0.65)]" />
      <div className="absolute bottom-[18%] left-[18%] h-1 w-1 rounded-full bg-[#E8C96A] shadow-[0_0_14px_3px_rgba(232,201,106,0.5)]" />
      <div className="absolute bottom-[12%] right-[22%] h-1.5 w-1.5 rounded-full bg-[#8BB8FF] shadow-[0_0_18px_4px_rgba(92,150,244,0.55)]" />
      <div className="absolute inset-0 shadow-[inset_0_0_180px_rgba(0,0,0,0.58)]" />
    </div>
    <div className="relative z-10 mx-auto max-w-4xl">
      <Link href="/" className="text-sm font-semibold text-[#E8C96A] transition-colors hover:text-[#fff1b3]">← Back to Hiroma</Link>
      <div className="mt-6 grid overflow-hidden rounded-3xl border border-[#E8C96A]/25 bg-white/95 shadow-[0_35px_100px_-30px_rgba(0,0,0,0.9),0_0_70px_-28px_rgba(201,168,76,0.38)] ring-1 ring-white/15 backdrop-blur-2xl lg:grid-cols-[0.7fr_1.3fr]">
        <aside className="bg-[radial-gradient(circle_at_20%_0%,rgba(40,83,170,0.28),transparent_38%),linear-gradient(155deg,#071331_0%,#010521_72%)] p-8 text-white lg:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">Help us improve</p>
          <h1 className="mt-3 text-3xl font-semibold">We’re listening.</h1>
          <p className="mt-4 text-sm leading-7 text-white/60">During development, your feedback helps us make Hiroma clearer, safer, and easier to use.</p>
          <div className="mt-8 space-y-4 text-sm text-white/75"><p>💡 Suggest an improvement</p><p>💬 Share your experience</p><p>🛠️ Report a website problem</p></div>
        </aside>
        <section className="p-6 sm:p-8 lg:p-10"><h2 className="text-xl font-semibold">Send feedback or a request</h2><p className="mt-1 mb-6 text-sm text-gray-500">Complete the form and it will appear directly in the admin Support Center.</p><SupportRequestForm /></section>
      </div>
    </div>
  </main>
}
