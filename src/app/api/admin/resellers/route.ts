import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resellers = await prisma.user.findMany({
      where: { role: 'reseller' },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        full_name: true,
        username: true,
        mobile: true,
        address: true,
        status: true,
        created_at: true,
        reseller_profile: {
          select: {
            total_points: true,
            daily_referral_count: true,
            daily_pairs_count: true,
            package: {
              select: { name: true, price: true },
            },
          },
        },
        wallet: {
          select: { balance: true },
        },
      },
    })

    return NextResponse.json({ resellers })
  } catch (error) {
    console.error('[GET RESELLERS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}