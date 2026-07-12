import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// Default cutoff days if not set
export const DEFAULT_CUTOFF_DAYS = [15, 31] // 31 = last day of month

// ── Helper: get cutoff days from DB ──
export async function getCutoffDays(): Promise<number[]> {
  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM system_settings WHERE key = 'payout_cutoff_days' LIMIT 1
    `
    if (!rows || rows.length === 0) return DEFAULT_CUTOFF_DAYS
    return rows[0].value.split(',').map(Number).filter(Boolean).sort((a, b) => a - b)
  } catch {
    return DEFAULT_CUTOFF_DAYS
  }
}

// ── Helper: get payout date map { cutoffDay -> payoutDay }
// Stored as JSON string e.g. {"15":"18","31":"3"}
// payoutDay > 28 means next month when cutoff is end of month
export async function getPayoutDateMap(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM system_settings WHERE key = 'payout_date_map' LIMIT 1
    `
    if (!rows || rows.length === 0) return { '15': '18', '31': '3' }
    return JSON.parse(rows[0].value)
  } catch {
    return { '15': '18', '31': '3' }
  }
}

// ── Helper: compute next cutoff date from today ──
export function getNextCutoffDate(cutoffDays: number[]): Date {
  const now   = new Date()
  const today = now.getDate()
  const year  = now.getFullYear()
  const month = now.getMonth()

  for (const day of cutoffDays) {
    const actualDay = day === 31
      ? new Date(year, month + 1, 0).getDate()
      : day
    if (today <= actualDay) {
      return new Date(year, month, actualDay)
    }
  }

  const firstDay = cutoffDays[0] === 31
    ? new Date(year, month + 2, 0).getDate()
    : cutoffDays[0]
  return new Date(year, month + 1, firstDay)
}

// ── Helper: compute payout date from cutoff date ──
export function getPayoutDateFromCutoff(cutoffDate: Date, payoutDateMap: Record<string, string>, cutoffDays: number[]): Date {
  const cutoffDay   = cutoffDate.getDate()
  const cutoffMonth = cutoffDate.getMonth()
  const cutoffYear  = cutoffDate.getFullYear()
  const lastDayOfMonth = new Date(cutoffYear, cutoffMonth + 1, 0).getDate()

  // Find matching cutoff key (31 means last day)
  const mapKey = cutoffDays.find((d) => {
    const actual = d === 31 ? lastDayOfMonth : d
    return actual === cutoffDay
  })

  const payoutDayStr = mapKey ? payoutDateMap[String(mapKey)] : null
  const payoutDay    = payoutDayStr ? parseInt(payoutDayStr) : null

  if (!payoutDay) {
    // Default: 2 days after cutoff
    const d = new Date(cutoffDate)
    d.setDate(d.getDate() + 2)
    return d
  }

  // If payout day <= cutoff day, it's next month
  if (payoutDay <= cutoffDay) {
    return new Date(cutoffYear, cutoffMonth + 1, payoutDay)
  }
  return new Date(cutoffYear, cutoffMonth, payoutDay)
}

// ── GET all settings ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT key, value FROM system_settings
    `
    const map: Record<string, string> = {}
    rows.forEach((s) => { map[s.key] = s.value })

    return NextResponse.json({
      payout_cutoff_days: map['payout_cutoff_days'] || '15,31',
      payout_date_map:    map['payout_date_map']    || '{"15":"18","31":"3"}',
    })
  } catch (error) {
    console.error('[ADMIN SETTINGS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH update settings ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { payout_cutoff_days, payout_date_map } = await req.json()

    if (payout_cutoff_days !== undefined) {
      // Validate: must be comma-separated numbers between 1-31
      const days = String(payout_cutoff_days).split(',').map((d) => parseInt(d.trim())).filter(Boolean)
      if (days.length === 0 || days.some((d) => d < 1 || d > 31)) {
        return NextResponse.json({ error: 'Invalid cutoff days. Use numbers 1–31 separated by commas.' }, { status: 400 })
      }
      await prisma.$executeRaw`
        INSERT INTO system_settings (id, key, value, updated_at, updated_by)
        VALUES (gen_random_uuid(), 'payout_cutoff_days', ${days.join(',')}, NOW(), ${user.id})
        ON CONFLICT (key) DO UPDATE SET value = ${days.join(',')}, updated_at = NOW(), updated_by = ${user.id}
      `
    }

    if (payout_date_map !== undefined) {
      const mapValue = typeof payout_date_map === 'string' ? payout_date_map : JSON.stringify(payout_date_map)
      await prisma.$executeRaw`
        INSERT INTO system_settings (id, key, value, updated_at, updated_by)
        VALUES (gen_random_uuid(), 'payout_date_map', ${mapValue}, NOW(), ${user.id})
        ON CONFLICT (key) DO UPDATE SET value = ${mapValue}, updated_at = NOW(), updated_by = ${user.id}
      `
    }

    return NextResponse.json({ success: true, message: 'Settings updated.' })
  } catch (error) {
    console.error('[ADMIN SETTINGS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}