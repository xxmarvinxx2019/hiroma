import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import { generateMemberId } from '@/app/lib/memberId'
import {
  ADMIN_STAFF_TYPE_KEYS,
  cleanAdminStaffPermissions,
  type AdminStaffType,
} from '@/app/lib/staffPermissions'

async function getAdminOwner() {
  const user = await getCurrentUser()
  return user?.role === 'admin' && !user.is_staff ? user : null
}

function cleanStaffType(value: unknown): AdminStaffType {
  const staffType = String(value || 'custom')
  return ADMIN_STAFF_TYPE_KEYS.has(staffType) ? staffType as AdminStaffType : 'custom'
}

export async function GET() {
  const owner = await getAdminOwner()
  if (!owner) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const staff = await prisma.staffProfile.findMany({
    where: { owner_id: owner.id },
    orderBy: { created_at: 'desc' },
    select: {
      id: true, staff_type: true, permissions: true, is_active: true, created_at: true,
      user: { select: { id: true, full_name: true, username: true, email: true, mobile: true } },
    },
  })
  return NextResponse.json({ staff })
}

export async function POST(request: NextRequest) {
  try {
    const owner = await getAdminOwner()
    if (!owner) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const body = await request.json()
    const fullName = String(body.full_name || '').trim()
    const username = String(body.username || '').trim().toLowerCase()
    const password = String(body.password || '')
    const mobile = String(body.mobile || '').trim()
    const email = String(body.email || '').trim() || null
    const staffType = cleanStaffType(body.staff_type)
    const permissions = cleanAdminStaffPermissions(body.permissions)

    if (!fullName || !mobile || password.length < 8 || !/^[a-z0-9._-]{3,}$/.test(username)) {
      return NextResponse.json({ error: 'Enter a full name, mobile number, valid username, and password of at least 8 characters.' }, { status: 400 })
    }
    if (permissions.length === 0) {
      return NextResponse.json({ error: 'Select at least one staff access permission.' }, { status: 400 })
    }
    if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) {
      return NextResponse.json({ error: 'Username is already in use.' }, { status: 409 })
    }

    const passwordHash = await hashPassword(password)
    const staff = await prisma.$transaction(async (tx) => {
      const memberId = await generateMemberId(tx)
      const user = await tx.user.create({
        data: { member_id: memberId, full_name: fullName, username, password_hash: passwordHash, mobile, email, role: 'staff', status: 'active', created_by: owner.id },
      })
      return tx.staffProfile.create({
        data: { user_id: user.id, owner_id: owner.id, staff_type: staffType, permissions },
        include: { user: { select: { id: true, full_name: true, username: true, email: true, mobile: true } } },
      })
    })
    return NextResponse.json({ staff }, { status: 201 })
  } catch (error) {
    console.error('[ADMIN STAFF POST]', error)
    return NextResponse.json({ error: 'Unable to create staff account.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const owner = await getAdminOwner()
  if (!owner) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const body = await request.json()
  const id = String(body.id || '')
  const current = await prisma.staffProfile.findFirst({ where: { id, owner_id: owner.id }, select: { id: true, user_id: true } })
  if (!current) return NextResponse.json({ error: 'Staff account not found.' }, { status: 404 })

  const permissions = body.permissions === undefined ? undefined : cleanAdminStaffPermissions(body.permissions)
  if (permissions && permissions.length === 0) {
    return NextResponse.json({ error: 'Select at least one staff access permission.' }, { status: 400 })
  }
  const isActive = typeof body.is_active === 'boolean' ? body.is_active : undefined
  const staffType = body.staff_type === undefined ? undefined : cleanStaffType(body.staff_type)
  await prisma.$transaction([
    prisma.staffProfile.update({
      where: { id: current.id },
      data: {
        ...(permissions && { permissions }),
        ...(staffType && { staff_type: staffType }),
        ...(isActive !== undefined && { is_active: isActive }),
      },
    }),
    prisma.user.update({
      where: { id: current.user_id },
      data: { ...(isActive !== undefined && { status: isActive ? 'active' : 'inactive' }) },
    }),
  ])
  return NextResponse.json({ success: true })
}
