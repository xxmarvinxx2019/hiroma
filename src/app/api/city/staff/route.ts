import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import { createAuditLog, getClientInfo, formatMemberId } from '@/app/lib/auditLog'
import { STAFF_PERMISSION_KEYS } from '@/app/lib/staffPermissions'

function cleanPermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string =>
    typeof item === 'string' && STAFF_PERMISSION_KEYS.has(item)
  ))]
}

async function getOwner() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city' || user.is_staff) return null
  return user
}

export async function GET() {
  try {
    const owner = await getOwner()
    if (!owner) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

    const staff = await prisma.staffProfile.findMany({
      where: { owner_id: owner.id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        permissions: true,
        is_active: true,
        created_at: true,
        user: {
          select: {
            id: true, full_name: true, username: true, email: true,
            mobile: true, status: true, created_at: true,
          },
        },
      },
    })
    return NextResponse.json({ staff })
  } catch (error) {
    console.error('[CITY STAFF GET ERROR]', error)
    return NextResponse.json({ error: 'Unable to load staff accounts.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwner()
    if (!owner) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

    const body = await req.json()
    const fullName = String(body.full_name || '').trim()
    const username = String(body.username || '').trim().toLowerCase()
    const password = String(body.password || '')
    const mobile = String(body.mobile || '').trim()
    const email = String(body.email || '').trim() || null
    const permissions = cleanPermissions(body.permissions)

    if (!fullName || !username || !mobile || password.length < 8) {
      return NextResponse.json({
        error: 'Full name, username, mobile, and a password of at least 8 characters are required.',
      }, { status: 400 })
    }
    if (!/^[a-z0-9._-]+$/.test(username)) {
      return NextResponse.json({ error: 'Username may only contain letters, numbers, dot, dash, and underscore.' }, { status: 400 })
    }
    if (permissions.length === 0) {
      return NextResponse.json({ error: 'Select at least one staff permission.' }, { status: 400 })
    }

    const exists = await prisma.user.findUnique({ where: { username }, select: { id: true } })
    if (exists) return NextResponse.json({ error: 'Username is already in use.' }, { status: 409 })

    const passwordHash = await hashPassword(password)
    const staff = await prisma.$transaction(async (tx) => {
      const staffUser = await tx.user.create({
        data: {
          full_name: fullName,
          username,
          password_hash: passwordHash,
          mobile,
          email,
          role: 'staff',
          status: 'active',
          created_by: owner.id,
        },
      })
      return tx.staffProfile.create({
        data: {
          user_id: staffUser.id,
          owner_id: owner.id,
          permissions,
        },
        include: { user: { select: { id: true, full_name: true, username: true } } },
      })
    })

    const { ip_address, device } = getClientInfo(req)
    createAuditLog({
      user_id: owner.id,
      user_name: owner.full_name,
      user_role: owner.role,
      member_id: formatMemberId(owner.id, owner.role),
      activity_type: 'staff_created',
      category: 'distributor',
      description: `${owner.full_name} created staff account ${fullName} (@${username})`,
      metadata: { staff_id: staff.user.id, permissions },
      ip_address,
      device,
      status: 'completed',
    })

    return NextResponse.json({ success: true, staff }, { status: 201 })
  } catch (error) {
    console.error('[CITY STAFF POST ERROR]', error)
    return NextResponse.json({ error: 'Unable to create staff account.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const owner = await getOwner()
    if (!owner) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

    const body = await req.json()
    const staffId = String(body.staff_id || '')
    const current = await prisma.staffProfile.findFirst({
      where: { id: staffId, owner_id: owner.id },
      select: { id: true, user_id: true },
    })
    if (!current) return NextResponse.json({ error: 'Staff account not found.' }, { status: 404 })

    const permissions = body.permissions === undefined ? undefined : cleanPermissions(body.permissions)
    if (permissions && permissions.length === 0) {
      return NextResponse.json({ error: 'Select at least one staff permission.' }, { status: 400 })
    }
    const isActive = typeof body.is_active === 'boolean' ? body.is_active : undefined

    await prisma.$transaction([
      prisma.staffProfile.update({
        where: { id: current.id },
        data: {
          ...(permissions && { permissions }),
          ...(isActive !== undefined && { is_active: isActive }),
        },
      }),
      prisma.user.update({
        where: { id: current.user_id },
        data: {
          ...(isActive !== undefined && { status: isActive ? 'active' : 'inactive' }),
          ...(body.password && String(body.password).length >= 8
            ? { password_hash: await hashPassword(String(body.password)) }
            : {}),
        },
      }),
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[CITY STAFF PATCH ERROR]', error)
    return NextResponse.json({ error: 'Unable to update staff account.' }, { status: 500 })
  }
}
