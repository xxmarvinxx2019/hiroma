import Link from 'next/link'

const modules = [
  {
    number: '01',
    title: 'Getting Started with Hiroma',
    description: 'Learn how your account, Digital ID, dashboard, and security settings work.',
    lessons: 'Orientation module',
    accent: '#0D1B3E',
    href: '/dashboard/reseller/learning-center/getting-started',
    available: true,
  },
  {
    number: '02',
    title: 'Products and Customer Care',
    description: 'Build product knowledge and learn the proper way to assist customers.',
    lessons: 'Product training',
    accent: '#087F5B',
    available: false,
  },
  {
    number: '03',
    title: 'Orders and Earnings',
    description: 'Understand ordering, wallets, payouts, commissions, and payment schedules.',
    lessons: 'Business essentials',
    accent: '#9A681A',
    href: '/dashboard/reseller/learning-center/orders-and-earnings',
    available: true,
  },
  {
    number: '04',
    title: 'Grow Your Hiroma Business',
    description: 'Learn ethical sharing, network building, leadership, and reseller best practices.',
    lessons: 'Growth academy',
    accent: '#5B3CC4',
    available: false,
  },
]

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export default function LearningCenterPage() {
  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="overflow-hidden rounded-3xl bg-[#010521] text-white shadow-sm">
        <div className="relative px-6 py-8 sm:px-9 sm:py-10">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#C9A84C]/15 blur-2xl" />
          <div className="relative max-w-2xl">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#C9A84C] text-[#0D1B3E]">
              <BookIcon />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#E5C56A]">Hiroma Academy</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Learning Center</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/65">Build your product knowledge, understand the Hiroma system, and develop the skills you need to grow responsibly.</p>
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#0D1B3E]">Learning paths</h2>
            <p className="mt-1 text-sm text-gray-400">Structured training designed for every Hiroma reseller.</p>
          </div>
          <span className="rounded-full bg-[#fff7df] px-3 py-1.5 text-xs font-semibold text-[#9A741F]">2 courses available</span>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {modules.map((module) => {
            const card = <article className="group relative overflow-hidden rounded-2xl border p-5 text-white transition duration-300 hover:-translate-y-1 hover:shadow-xl"
              style={{ background: `linear-gradient(145deg, rgba(255,255,255,.15), rgba(0,0,0,.18)), ${module.accent}`, borderColor: 'rgba(255,255,255,.28)', borderTop: '3px solid rgba(255,255,255,.58)', boxShadow: `0 10px 28px ${module.accent}35` }}>
              <div aria-hidden="true" className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-white/15 blur-3xl transition-transform group-hover:scale-125" />
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/20 text-xs font-bold text-white">{module.number}</span>
                  <span className="rounded-full border border-white/20 bg-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80">{module.available ? 'Available now' : 'Coming soon'}</span>
                </div>
                <h3 className="mt-5 text-base font-semibold text-white">{module.title}</h3>
                <p className="mt-2 min-h-12 text-sm leading-6 text-white/70">{module.description}</p>
                <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-4">
                  <span className="text-xs font-medium text-white/60">{module.lessons}</span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-white">{module.available ? 'Start course' : 'Preview'} <ArrowIcon /></span>
                </div>
              </div>
            </article>
            return module.available && module.href
              ? <Link key={module.number} href={module.href} aria-label={`Start ${module.title}`}>{card}</Link>
              : <div key={module.number} aria-disabled="true">{card}</div>
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-[#C9A84C]/30 bg-[#fffaf0] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div>
          <h2 className="text-sm font-semibold text-[#0D1B3E]">Start with your official account orientation</h2>
          <p className="mt-1 text-sm leading-6 text-gray-500">Getting Started with Hiroma and Orders and Earnings are available now. Product and growth courses will be activated after their content is reviewed and approved.</p>
        </div>
        <Link href="/dashboard/reseller/learning-center/getting-started" className="mt-4 inline-flex shrink-0 rounded-xl bg-[#0D1B3E] px-4 py-2.5 text-xs font-semibold text-white sm:mt-0">Open Course 01 →</Link>
      </div>
    </section>
  )
}
