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

    const previous = await prisma.user.findUnique({
      where: { id: user.id },
      select: { full_name: true, email: true, mobile: true, address: true },
    })
    if (!previous) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    const nextProfile = {
      full_name: full_name.trim(),
      mobile: mobile.trim(),
      address: address?.trim() || null,
      email: email?.trim().toLowerCase() || null,
    }
    const changedFields = [
      previous.full_name !== nextProfile.full_name ? 'name' : null,
      previous.mobile !== nextProfile.mobile ? 'mobile number' : null,
      previous.email !== nextProfile.email ? 'email address' : null,
      previous.address !== nextProfile.address ? 'address' : null,
    ].filter((field): field is string => Boolean(field))

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: nextProfile,
        select: {
          id: true, full_name: true, username: true,
          email: true, mobile: true, address: true,
        },
      }),
      ...(changedFields.length > 0
        ? [prisma.notification.create({
            data: {
              user_id: user.id,
              type: 'security_profile_changed',
              title: 'Account information updated',
              message: `Your registered ${changedFields.join(', ')} ${changedFields.length === 1 ? 'was' : 'were'} updated. If this was not you, contact Hiroma support immediately.`,
              entity_type: 'security',
              action_url: '/dashboard/reseller/profile',
            },
          })]
        : []),
    ])

    return NextResponse.json({ success: true, user: updated })
  } catch (error) {
    console.error('[RESELLER PROFILE PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
