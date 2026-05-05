import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resellers = await prisma.user.findMany({
      where: { role: 'reseller', created_by: user.id },
      orderBy: { created_at: 'desc' },
      take: 8,
      select: {
        id: true,
        full_name: true,
        username: true,
        created_at: true,
        reseller_profile: {
          select: {
            package: { select: { name: true } },
          },
        },
      },
    })

    return NextResponse.json({ resellers })
  } catch (error) {
    console.error('[CITY RECENT RESELLERS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}