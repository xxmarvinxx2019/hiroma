import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getProfilePhotoDisplayUrl } from '@/app/lib/profilePhoto'

const resellerProfileSelect = {
  id: true,
  full_name: true,
  username: true,
  email: true,
  mobile: true,
  profile_photo: true,
  address: true,
  status: true,
  created_at: true,
  reseller_profile: {
    select: {
      total_points: true,
      rank: true,
      package: { select: { name: true, price: true } },
      city_dist: { select: { full_name: true, username: true } },
      pin: { select: { pin_code: true } },
    },
  },
} as const

// ── GET reseller profile ──
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Existing deployments may not have run the Member ID migration yet.
    // Probe the schema first so we never select a column that does not exist.
    const memberIdColumn = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'member_id'
      ) AS exists
    `
    const hasMemberId = memberIdColumn[0]?.exists === true
    const resellerProfileWithMemberId = {
      select: {
        total_points: true,
        rank: true,
        package: { select: { name: true, price: true } },
        city_dist: {
          select: {
            full_name: true,
            username: true,
            ...(hasMemberId ? { member_id: true } : {}),
          },
        },
        pin: { select: { pin_code: true } },
      },
    }
    const data = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        ...resellerProfileSelect,
        ...(hasMemberId ? { member_id: true } : {}),
        reseller_profile: resellerProfileWithMemberId,
        binary_tree_node: {
          select: {
            sponsor: {
              select: {
                full_name: true,
                username: true,
                ...(hasMemberId ? { member_id: true } : {}),
              },
            },
          },
        },
      },
    })

    let profilePhoto: string | null = null
    try {
      profilePhoto = await getProfilePhotoDisplayUrl(data?.profile_photo)
    } catch (photoError) {
      // A storage configuration problem must not block the member's profile or Digital ID.
      console.warn('[RESELLER PROFILE PHOTO URL ERROR]', photoError)
    }

    return NextResponse.json({
      user: data ? {
        ...data,
        member_id: data.member_id || null,
        profile_photo: profilePhoto,
      } : data,
    })
  } catch (error) {
    console.error('[RESELLER PROFILE GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH update profile ──
export async function PATCH() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({ error: 'Registered personal information is managed by Hiroma administrators.' }, { status: 403 })
  } catch (error) {
    console.error('[RESELLER PROFILE PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
