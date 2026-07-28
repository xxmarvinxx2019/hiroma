import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1))
    const pageSize = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize') || 20)))
    const unreadOnly = req.nextUrl.searchParams.get('unread') === 'true'
    const where = { user_id: user.id, ...(unreadOnly ? { read_at: null } : {}) }

    const [notifications, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { user_id: user.id, read_at: null } }),
    ])

    return NextResponse.json({
      notifications,
      unread,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error('[NOTIFICATIONS GET ERROR]', error)
    return NextResponse.json({ error: 'Unable to load notifications.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id, all } = await req.json()
    if (!all && !id) {
      return NextResponse.json({ error: 'Notification id is required.' }, { status: 400 })
    }

    if (all) {
      await prisma.notification.updateMany({
        where: { user_id: user.id, read_at: null },
        data: { read_at: new Date() },
      })
    } else {
      const result = await prisma.notification.updateMany({
        where: { id, user_id: user.id, read_at: null },
        data: { read_at: new Date() },
      })
      if (result.count === 0) {
        const exists = await prisma.notification.count({ where: { id, user_id: user.id } })
        if (!exists) return NextResponse.json({ error: 'Notification not found.' }, { status: 404 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[NOTIFICATIONS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Unable to update notification.' }, { status: 500 })
  }
}
