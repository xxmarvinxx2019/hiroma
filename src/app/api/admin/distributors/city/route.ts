import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const distributors = await prisma.user.findMany({
      where: { role: 'city', status: 'active' },
      orderBy: { full_name: 'asc' },
      select: {
        id: true,
        full_name: true,
        username: true,
      },
    })

    return NextResponse.json({ distributors })
  } catch (error) {
    console.error('[GET CITY DISTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}