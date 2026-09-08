import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DEFAULT_MAINTENANCE_MESSAGE, getMaintenanceState } from '@/app/lib/maintenanceMode'

export const dynamic = 'force-dynamic'

export default async function MaintenancePage() {
  let unavailable = false
  let state = {
    enabled: true,
    message: DEFAULT_MAINTENANCE_MESSAGE,
    startedAt: null as string | null,
  }

  try {
    const current = await getMaintenanceState()
    state = { enabled: current.enabled, message: current.message, startedAt: current.startedAt }
  } catch (error) {
    unavailable = true
    console.error('[MAINTENANCE PAGE ERROR]', error)
  }

  if (!unavailable && !state.enabled) redirect('/login')

  const started = state.startedAt
    ? new Intl.DateTimeFormat('en-PH', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Manila',
      }).format(new Date(state.startedAt))
    : null

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#02061f] px-5 py-12 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(33,91,150,0.35),transparent_38%),radial-gradient(circle_at_80%_70%,rgba(201,168,76,0.16),transparent_35%)]" />
      <section className="relative w-full max-w-xl rounded-3xl border border-white/10 bg-[#07102f]/95 p-7 shadow-2xl backdrop-blur md:p-10">
        <div className="mb-8 flex items-center gap-3">
          <Image src="/hiroma-logo.jpg" width={48} height={48} alt="Hiroma" className="rounded-xl" priority />
          <div>
            <p className="text-sm font-semibold tracking-[0.28em] text-[#d9bd68]">HIROMA</p>
            <p className="text-xs text-white/50">Protected maintenance window</p>
          </div>
        </div>

        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />
          {unavailable ? 'Service temporarily unavailable' : 'Maintenance in progress'}
        </div>
        <h1 className="text-3xl font-semibold leading-tight md:text-4xl">We’ll be back shortly.</h1>
        <p className="mt-4 text-sm leading-7 text-white/65">{state.message}</p>
        {started && <p className="mt-4 text-xs text-white/40">Started {started} (Philippine time)</p>}

        <div className="mt-8 rounded-2xl border border-white/8 bg-white/[0.04] p-4 text-xs leading-6 text-white/55">
          New registrations, upgrades, sales, payouts, commission jobs, and other changes are paused to protect transaction data. Please do not refresh repeatedly.
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-white/35">No transaction will be accepted while protection is active.</p>
          <Link href="/login/admin" className="text-xs font-semibold text-[#d9bd68] hover:text-[#f1d98d]">
            Admin recovery sign-in →
          </Link>
        </div>
      </section>
    </main>
  )
}

