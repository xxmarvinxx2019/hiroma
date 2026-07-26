import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !['city', 'admin'].includes(user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const username = req.nextUrl.searchParams.get('username')?.trim().toLowerCase()
  if (!username) {
    return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  })

  return NextResponse.json({ available: !existing })
}
