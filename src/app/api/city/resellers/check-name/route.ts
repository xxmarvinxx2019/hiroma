import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !['city', 'admin'].includes(user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const name = req.nextUrl.searchParams.get('name')?.trim()
  if (!name) {
    return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  }

  const normalizedName = name.toLowerCase().replace(/\s+/g, ' ')
  const registry = await prisma.nameCapRegistry.findUnique({
    where: { normalized_name: normalizedName },
    select: { count: true, max_allowed: true },
  })

  const count = registry?.count ?? 0
  const max = registry?.max_allowed ?? 7

  return NextResponse.json({
    count,
    max,
    remaining: Math.max(0, max - count),
  })
}
