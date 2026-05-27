import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── Generate unique PIN code ──
function generatePinCode(packageName: string): string {
  const prefix  = 'HRM'
  const year    = new Date().getFullYear()
  const tier    = packageName.slice(0, 3).toUpperCase()
  const random  = Math.floor(10000 + Math.random() * 90000)
  return `${prefix}-${year}-${tier}-${random}`
}

// ── GET ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['admin', 'city'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const status   = searchParams.get('status')   || 'all'
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))
    const search   = searchParams.get('search')   || ''

    const where: any = {
      ...(user.role === 'city' && { city_dist_id: user.id }),
      ...(status !== 'all'     && { status }),
      ...(search && {
        OR: [
          { city_dist: { full_name: { contains: search, mode: 'insensitive' } } },
          { city_dist: { username:  { contains: search, mode: 'insensitive' } } },
          { package:   { name:      { contains: search, mode: 'insensitive' } } },
        ],
      }),
    }

    const [total, requests, summaryRaw] = await Promise.all([
      prisma.pinRequest.count({ where }),
      prisma.pinRequest.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id: true, quantity: true, total_amount: true,
          payment_method: true, payment_reference: true,
          payment_sender_name: true, payment_datetime: true,
          payment_status: true, status: true, notes: true,
          created_at: true, updated_at: true,
          city_dist: { select: { id: true, full_name: true, username: true } },
          package:   { select: { id: true, name: true, price: true } },
        },
      }),
      prisma.pinRequest.groupBy({
        by:    ['status'],
        where: user.role === 'city' ? { city_dist_id: user.id } : {},
        _count: { status: true },
      }),
    ])

    const summary = { total: 0, pending: 0, approved: 0, rejected: 0 }
    for (const row of summaryRaw) {
      summary.total += row._count.status
      if (row.status === 'pending')  summary.pending  = row._count.status
      if (row.status === 'approved') summary.approved = row._count.status
      if (row.status === 'rejected') summary.rejected = row._count.status
    }

    return NextResponse.json({
      requests, summary,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[PIN REQUESTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST — city dist creates a PIN request ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      package_id, quantity, notes,
      payment_method, payment_reference, payment_sender_name, payment_datetime,
    } = await req.json()

    if (!package_id || !quantity || quantity < 1) {
      return NextResponse.json({ error: 'Package and quantity are required.' }, { status: 400 })
    }

    const pkg = await prisma.package.findUnique({
      where:  { id: package_id },
      select: { id: true, name: true, price: true, is_active: true },
    })

    if (!pkg || !pkg.is_active) {
      return NextResponse.json({ error: 'Package not found or inactive.' }, { status: 400 })
    }

    const total_amount = Number(pkg.price) * quantity

    const request = await prisma.pinRequest.create({
      data: {
        city_dist_id:        user.id,
        package_id,
        quantity,
        total_amount,
        payment_method:      payment_method      || 'cash_on_pickup',
        payment_reference:   payment_reference?.trim()   || null,
        payment_sender_name: payment_sender_name?.trim() || null,
        payment_datetime:    payment_datetime ? new Date(payment_datetime) : null,
        payment_status:      payment_method === 'cash_on_pickup' ? 'unpaid' : 'pending',
        status:              'pending',
        notes:               notes?.trim() || null,
      },
    })

    return NextResponse.json({ success: true, request })
  } catch (error) {
    console.error('[PIN REQUESTS POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH — admin approves/rejects + confirms payment ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, status, payment_status } = await req.json()

    if (!id) {
      return NextResponse.json({ error: 'Request ID required.' }, { status: 400 })
    }

    const request = await prisma.pinRequest.findUnique({
      where:  { id },
      select: {
        id: true, quantity: true, status: true,
        city_dist_id: true,
        package: { select: { id: true, name: true, price: true } },
      },
    })

    if (!request) {
      return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
    }

    if (request.status === 'approved' || request.status === 'rejected') {
      return NextResponse.json({ error: 'Request already finalized.' }, { status: 400 })
    }

    // Update request status
    await prisma.pinRequest.update({
      where: { id },
      data: {
        ...(status         && { status }),
        ...(payment_status && { payment_status }),
        updated_at: new Date(),
      },
    })

    // If approved → generate and assign PINs to city dist
    if (status === 'approved') {
      const pins = []
      const existingCodes = new Set<string>()

      for (let i = 0; i < request.quantity; i++) {
        let pinCode: string
        let attempts = 0

        // Ensure unique PIN code
        do {
          pinCode = generatePinCode(request.package.name)
          attempts++
        } while (existingCodes.has(pinCode) && attempts < 10)

        existingCodes.add(pinCode)
        pins.push({
          pin_code:      pinCode,
          package_id:    request.package.id,
          city_dist_id:  request.city_dist_id,
          status:        'unused',
          generated_by:  user.id,
        })
      }

      await prisma.pin.createMany({ data: pins })

      console.log(`[PIN REQUEST] Generated ${pins.length} PINs for city dist ${request.city_dist_id}`)
    }

    return NextResponse.json({
      success: true,
      message: status === 'approved'
        ? `${request.quantity} PINs generated and assigned successfully.`
        : `Request ${status}.`,
    })
  } catch (error) {
    console.error('[PIN REQUESTS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}