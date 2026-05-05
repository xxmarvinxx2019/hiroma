import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pin_code } = await req.json()

    if (!pin_code) {
      return NextResponse.json({ error: 'PIN code is required.' }, { status: 400 })
    }

    const pin = await prisma.pin.findUnique({
      where: { pin_code: pin_code.trim().toUpperCase() },
      select: {
        id: true,
        pin_code: true,
        status: true,
        city_dist_id: true,
        package: { select: { id: true, name: true, price: true } },
      },
    })

    if (!pin) {
      return NextResponse.json({ error: 'PIN not found. Please check and try again.' }, { status: 404 })
    }

    if (pin.status !== 'unused') {
      return NextResponse.json({ error: `This PIN has already been ${pin.status}.` }, { status: 400 })
    }

    if (pin.city_dist_id !== user.id) {
      return NextResponse.json({ error: 'This PIN does not belong to your account.' }, { status: 400 })
    }

    return NextResponse.json({ pin })
  } catch (error) {
    console.error('[VERIFY PIN ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}