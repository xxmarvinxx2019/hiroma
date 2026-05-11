import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET reseller profile ──
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const data = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id:        true,
        full_name: true,
        username:  true,
        email:     true,
        mobile:    true,
        address:   true,
        status:    true,
        created_at: true,
        reseller_profile: {
          select: {
            total_points: true,
            package: { select: { name: true, price: true } },
            city_dist: { select: { full_name: true, username: true } },
            pin: { select: { pin_code: true } },
          },
        },
      },
    })

    return NextResponse.json({ user: data })
  } catch (error) {
    console.error('[RESELLER PROFILE GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH update profile ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { full_name, email, mobile, address } = await req.json()

    if (!full_name?.trim() || !mobile?.trim()) {
      return NextResponse.json({ error: 'Full name and mobile are required.' }, { status: 400 })
    }

    // Check email uniqueness
    if (email?.trim()) {
      const existing = await prisma.user.findFirst({
        where: { email: email.trim().toLowerCase(), NOT: { id: user.id } },
      })
      if (existing) {
        return NextResponse.json({ error: 'Email is already in use.' }, { status: 400 })
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
      },
    })

    return NextResponse.json({ success: true, user: updated })
  } catch (error) {
    console.error('[RESELLER PROFILE PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}