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

    const { full_name, email, mobile, address } = await req.json()

    if (!full_name || !mobile) {
      return NextResponse.json(
        { error: 'Full name and mobile are required.' },
        { status: 400 }
      )
    }

    // Check email uniqueness
    if (email) {
      const existing = await prisma.user.findFirst({
        where: { email: email.trim().toLowerCase(), NOT: { id: user.id } },
      })
      if (existing) {
        return NextResponse.json(
          { error: 'Email already in use by another account.' },
          { status: 400 }
        )
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        full_name: full_name.trim(),
        mobile:    mobile.trim(),
        address:   address?.trim() || null,
        email:     email?.trim().toLowerCase() || null,
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