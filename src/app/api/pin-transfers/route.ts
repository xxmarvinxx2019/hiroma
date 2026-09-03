import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { boundedPage, boundedPageSize } from '@/app/lib/pagination'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['admin', 'city'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role === 'city') {
      const profile = await prisma.distributorProfile.findUnique({
        where: { user_id: user.id },
        select: { dist_level: true, is_active: true },
      })
      if (!profile?.is_active || profile.dist_level !== 'branch') {
        return NextResponse.json({ error: 'Only an active Hiroma Branch may receive internal PIN transfers.' }, { status: 403 })
      }
    }

    const page = boundedPage(req.nextUrl.searchParams.get('page'))
    const pageSize = boundedPageSize(req.nextUrl.searchParams.get('pageSize'), 15, 50)
    const status = req.nextUrl.searchParams.get('status') || 'all'
    if (!['all', 'in_transit', 'received', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Invalid transfer status.' }, { status: 400 })
    }
    const where = {
      ...(user.role === 'admin' ? { admin_id: user.id } : { recipient_id: user.id }),
      ...(status !== 'all' && { status }),
    }
    const [total, transfers] = await Promise.all([
      prisma.pinTransfer.count({ where }),
      prisma.pinTransfer.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { pins: true } } },
      }),
    ])
    const [packages, users] = await Promise.all([
      prisma.package.findMany({
        where: { id: { in: [...new Set(transfers.map((transfer) => transfer.package_id))] } },
        select: { id: true, name: true },
      }),
      prisma.user.findMany({
        where: { id: { in: [...new Set(transfers.flatMap((transfer) => [transfer.admin_id, transfer.recipient_id]))] } },
        select: { id: true, full_name: true, username: true },
      }),
    ])
    const packageMap = new Map(packages.map((pkg) => [pkg.id, pkg]))
    const userMap = new Map(users.map((entry) => [entry.id, entry]))

    return NextResponse.json({
      transfers: transfers.map((transfer) => ({
        ...transfer,
        unit_allocation: Number(transfer.unit_allocation),
        reference_value: Number(transfer.reference_value),
        sale_value: Number(transfer.sale_value),
        package: packageMap.get(transfer.package_id) || null,
        sender: userMap.get(transfer.admin_id) || null,
        recipient: userMap.get(transfer.recipient_id) || null,
        pin_count: transfer._count.pins,
        _count: undefined,
      })),
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[PIN TRANSFERS GET ERROR]', error)
    return NextResponse.json({ error: 'Unable to load PIN transfers.' }, { status: 500 })
  }
}
