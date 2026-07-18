import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── Helper: get active rank period for a package ──
export async function getActivePeriod(packageId: string) {
  try {
    const now  = new Date()
    const rows = await prisma.$queryRaw<{ id: string; start_date: string; end_date: string }[]>`
      SELECT id, start_date::text, end_date::text FROM rank_periods
      WHERE package_id::text = ${packageId}
        AND is_active = true
        AND start_date <= ${now}
        AND end_date   >= ${now}
      LIMIT 1
    `
    return rows[0] || null
  } catch { return null }
}

// ── Helper: get ranks for a package sorted by sequence ──
export async function getRanksForPackage(packageId: string) {
  try {
    const rows = await prisma.$queryRaw<{
      id: string; name: string; sequence: number; required_pu: number; pair_income: string
    }[]>`
      SELECT id, name, sequence, required_pu, pair_income::text
      FROM ranks
      WHERE package_id::text = ${packageId}
      ORDER BY sequence ASC
    `
    if (!rows || rows.length === 0) return []
    return rows.map(r => ({ ...r, pair_income: Number(r.pair_income) }))
  } catch (e) {
    console.error('[RANKS] getRanksForPackage failed:', e)
    return []
  }
}

// ── Helper: get current rank for a reseller based on total_pu ──
// Returns null if no active period or no ranks configured (use package default)
export async function getCurrentRankForReseller(packageId: string, totalPU: number) {
  const period = await getActivePeriod(packageId)
  if (!period) return null  // No active period — use package default

  const ranks = await getRanksForPackage(packageId)
  if (!ranks || ranks.length === 0) return null  // No ranks — use package default

  // Find highest rank the reseller qualifies for
  let current = null
  for (const rank of ranks) {
    if (totalPU >= rank.required_pu) current = rank
    else break
  }
  return current  // null means hasn't reached any rank yet — use package default
}

// ── GET all packages with ranks and periods ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const package_id = searchParams.get('package_id')

    const packages = await prisma.package.findMany({
      where:   { is_active: true },
      select:  { id: true, name: true, point_php_value: true },
      orderBy: { price: 'asc' },
    })

    const ranks = await prisma.$queryRaw<{
      id: string; package_id: string; name: string; sequence: number; required_pu: number; pair_income: string
    }[]>`
      SELECT id, package_id::text, name, sequence, required_pu, pair_income::text
      FROM ranks ORDER BY package_id, sequence ASC
    `

    const periods = await prisma.$queryRaw<{
      id: string; package_id: string; start_date: string; end_date: string; is_active: boolean
    }[]>`
      SELECT id, package_id::text, start_date::text, end_date::text, is_active
      FROM rank_periods ORDER BY package_id, start_date DESC
    `

    return NextResponse.json({
      packages,
      ranks:   ranks.map(r => ({ ...r, pair_income: Number(r.pair_income) })),
      periods,
    })
  } catch (error) {
    console.error('[ADMIN RANKS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST create/update rank or period ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    // Save rank period
    if (body.type === 'period') {
      const { package_id, start_date, end_date, period_id } = body
      if (!package_id || !start_date || !end_date) {
        return NextResponse.json({ error: 'package_id, start_date and end_date are required.' }, { status: 400 })
      }
      if (period_id) {
        await prisma.$executeRaw`
          UPDATE rank_periods SET start_date = ${new Date(start_date)}, end_date = ${new Date(end_date)}
          WHERE id::text = ${period_id}
        `
      } else {
        await prisma.$executeRaw`
          INSERT INTO rank_periods (id, package_id, start_date, end_date, is_active)
          VALUES (uuid_generate_v4(), ${package_id}::uuid, ${new Date(start_date)}, ${new Date(end_date)}, true)
        `
      }
      return NextResponse.json({ success: true, message: 'Rank period saved.' })
    }

    // Save rank
    const { id, package_id, name, sequence, required_pu, pair_income } = body
    if (!package_id || !name || sequence === undefined || required_pu === undefined || pair_income === undefined) {
      return NextResponse.json({ error: 'All rank fields are required.' }, { status: 400 })
    }

    if (id) {
      await prisma.$executeRaw`
        UPDATE ranks SET name = ${name}, sequence = ${Number(sequence)},
          required_pu = ${Number(required_pu)}, pair_income = ${Number(pair_income)}
        WHERE id::text = ${id}
      `
    } else {
      await prisma.$executeRaw`
        INSERT INTO ranks (id, package_id, name, sequence, required_pu, pair_income)
        VALUES (uuid_generate_v4(), ${package_id}::uuid, ${name}, ${Number(sequence)}, ${Number(required_pu)}, ${Number(pair_income)})
      `
    }

    return NextResponse.json({ success: true, message: 'Rank saved.' })
  } catch (error) {
    console.error('[ADMIN RANKS POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── DELETE rank or period ──
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, type } = await req.json()
    if (type === 'period') {
      await prisma.$executeRaw`DELETE FROM rank_periods WHERE id::text = ${id}`
    } else {
      await prisma.$executeRaw`DELETE FROM ranks WHERE id::text = ${id}`
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[ADMIN RANKS DELETE ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}