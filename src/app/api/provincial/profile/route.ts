import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── PATCH update city distributor profile ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'provincial') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { address } = body
    if (typeof address !== 'string') return NextResponse.json({ error: 'Address is required.' }, { status: 400 })
    if (['full_name', 'email', 'mobile'].some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
      return NextResponse.json({ error: 'Registered identity and contact information is managed through an authorized administrator.' }, { status: 403 })
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        address:   address?.trim() || null,
      },
      select: {
        id: true, full_name: true, username: true,
        email: true, mobile: true, address: true,
        distributor_profile: { select: { coverage_area: true, dist_level: true } },
      },
    })

    return NextResponse.json({ success: true, user: updated })
  } catch (error) {
    console.error('[PROVINCIAL PROFILE PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
