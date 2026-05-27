import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || !['city', 'provincial', 'regional', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const packages = await prisma.package.findMany({
      where:   { is_active: true },
      select:  { id: true, name: true, price: true },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ packages })
  } catch (error) {
    console.error('[CITY PACKAGES ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}