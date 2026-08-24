import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { calculatePackageEconomics } from '@/app/lib/package-economics'
import { PinStatus, Prisma } from '@prisma/client'

const PIN_TYPES = new Set(['registration', 'upgrade'])

function reportingRange(from: string, to: string) {
  if (!from && !to) return null
  return {
    ...(from && { gte: new Date(`${from}T00:00:00+08:00`) }),
    ...(to && { lte: new Date(`${to}T23:59:59.999+08:00`) }),
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status    = searchParams.get('status')   || 'unused'
    const page      = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize  = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '15')))
    const search    = searchParams.get('search')   || ''
    const packageId = searchParams.get('package')  || ''
    const dateFrom  = searchParams.get('dateFrom') || ''
    const dateTo    = searchParams.get('dateTo')   || ''
    const pinType   = searchParams.get('pinType')  || 'all'

    if (status !== 'all' && !Object.values(PinStatus).includes(status as PinStatus)) {
      return NextResponse.json({ error: 'Invalid PIN status filter.' }, { status: 400 })
    }
    if (pinType !== 'all' && !PIN_TYPES.has(pinType)) {
      return NextResponse.json({ error: 'Invalid PIN type filter.' }, { status: 400 })
    }

    const normalizedSearch = search.trim().toLowerCase()
    const searchableStatuses = ['unused', 'used', 'expired', 'cancelled'] as const
    const searchedStatus = searchableStatuses.find((value) => value === normalizedSearch)
    const searchedPinType = PIN_TYPES.has(normalizedSearch) ? normalizedSearch : null
    const searchDateMatch = normalizedSearch.match(/^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))$/)
    const searchDate = searchDateMatch ? new Date(Number(searchDateMatch[1] || searchDateMatch[6]), Number(searchDateMatch[2] || searchDateMatch[4]) - 1, Number(searchDateMatch[3] || searchDateMatch[5])) : null
    const validSearchDate = searchDate && !Number.isNaN(searchDate.getTime()) ? searchDate : null

    // ── Build where clause ──
    const where: Prisma.PinWhereInput = {
      city_dist_id: user.id,
      ...(pinType !== 'all' && { pin_type: pinType }),
    }

    if (searchedStatus || status !== 'all') {
      where.status = (searchedStatus || status) as PinStatus
    }

    if (searchedPinType) where.pin_type = searchedPinType

    if (search && !searchedStatus && !searchedPinType && !validSearchDate) {
      where.OR = [
        { pin_code: { contains: search, mode: 'insensitive' } },
        { package: { name: { contains: search, mode: 'insensitive' } } },
        { used_by_user: { username: { contains: search, mode: 'insensitive' } } },
        { used_by_user: { full_name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    if (packageId) {
      where.package_id = packageId
    }

    const effectiveStatus = searchedStatus || status
    const explicitRange = reportingRange(dateFrom, dateTo)
    if (validSearchDate) {
      const searchDateEnd = new Date(validSearchDate)
      searchDateEnd.setHours(23, 59, 59, 999)
      const range = { gte: validSearchDate, lte: searchDateEnd }
      if (effectiveStatus === 'used') where.used_at = range
      else if (effectiveStatus === 'cancelled') where.cancelled_at = range
      else where.created_at = range
    } else if (explicitRange) {
      if (effectiveStatus === 'used') where.used_at = explicitRange
      else if (effectiveStatus === 'cancelled') where.cancelled_at = explicitRange
      else if (effectiveStatus === 'all') where.OR = [
        { created_at: explicitRange }, { used_at: explicitRange }, { cancelled_at: explicitRange },
      ]
      else where.created_at = explicitRange
    }

    // ── Count total ──
    const total = await prisma.pin.count({ where })

    // ── Fetch paginated PINs + packages for filter dropdown ──
    const [pins, packages] = await Promise.all([
      prisma.pin.findMany({
        where,
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          pin_code: true,
          status: true,
          pin_type: true,
          upgrade_from_package_id: true,
          pin_allocation_snapshot: true,
          created_at: true,
          used_at: true,
          cancelled_at: true,
          cancellation_reason: true,
          package: {
            select: {
              name: true,
              price: true,
              products: {
                select: {
                  quantity: true,
                  product: { select: { price: true, reseller_price: true } },
                },
              },
            },
          },
          used_by_user: {
            select: { full_name: true, username: true },
          },
        },
      }),

      prisma.package.findMany({
        select:  { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])

    // ── Summary counts (all statuses, no filter) ──
    const [totalAll, unused, used, expired, cancelled, registration, upgrade] = await Promise.all([
      prisma.pin.count({ where: { city_dist_id: user.id } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'unused'  } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'used'    } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'expired' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'cancelled' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, pin_type: 'registration' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, pin_type: 'upgrade' } }),
    ])

    return NextResponse.json({
      pins: pins.map((pin) => ({
        ...pin,
        upgrade_from_package: pin.upgrade_from_package_id
          ? packages.find((pkg) => pkg.id === pin.upgrade_from_package_id) || null
          : null,
        package: {
          name: pin.package.name,
          price: pin.pin_allocation_snapshot != null
            ? Number(pin.pin_allocation_snapshot)
            : pin.package.products.length > 0
            ? calculatePackageEconomics(pin.package.products).pinAllocation
            : Number(pin.package.price),
        },
      })),
      packages,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      summary: {
        total: totalAll,
        unused,
        used,
        expired,
        cancelled,
        registration,
        upgrade,
      },
    })
  } catch (error) {
    console.error('[CITY PINS ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong.' },
      { status: 500 }
    )
  }
}
