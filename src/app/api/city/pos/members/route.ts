import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const search = (req.nextUrl.searchParams.get('search') || '').trim().slice(0, 80)
    if (search.length < 2) return NextResponse.json({ members: [] })

    const members = await prisma.user.findMany({
      where: {
        role: 'reseller',
        status: 'active',
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { full_name: { contains: search, mode: 'insensitive' } },
          { member_id: { contains: search, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ username: 'asc' }],
      take: 8,
      select: { id: true, member_id: true, username: true, full_name: true },
    })
    return NextResponse.json({ members })
  } catch (error) {
    console.error('[POS MEMBER LOOKUP]', error)
    return NextResponse.json({ error: 'Unable to search members.' }, { status: 500 })
  }
}
