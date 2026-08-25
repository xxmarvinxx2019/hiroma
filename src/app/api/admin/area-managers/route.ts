import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import { generateMemberId } from '@/app/lib/memberId'
import { createAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

const BRANCH_PERMISSION_PREFIX = 'area_branch:'

async function requireAdminOwner() {
  const user = await getCurrentUser()
  return user?.role === 'admin' && !user.is_staff ? user : null
}

function assignmentIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 1000)
}

async function validDistributorIds(ids: string[]) {
  if (!ids.length) return []
  const distributors = await prisma.user.findMany({
    where: { id: { in: ids }, role: 'city', status: 'active', distributor_profile: { is: { dist_level: 'branch', is_active: true } } },
    select: { id: true },
  })
  return distributors.map(({ id }) => id)
}

export async function GET() {
  try {
    const admin = await requireAdminOwner()
    if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const [managerProfiles, distributors] = await Promise.all([
    prisma.staffProfile.findMany({
      where: { owner_id: admin.id, staff_type: 'area_manager' },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, is_active: true, created_at: true, permissions: true,
        user: {
          select: {
            id: true, full_name: true, username: true, email: true, mobile: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: 'city', status: 'active', distributor_profile: { is: { dist_level: 'branch', is_active: true } } },
      orderBy: { full_name: 'asc' },
      select: { id: true, full_name: true, username: true, distributor_profile: { select: { dist_level: true, coverage_area: true, fulfillment_outlet_name: true } } },
    }),
    ])
    const managers = managerProfiles.map((profile) => ({
      ...profile,
      user: {
        ...profile.user,
        area_manager_assignments: (Array.isArray(profile.permissions) ? profile.permissions : [])
          .filter((permission): permission is string => typeof permission === 'string' && permission.startsWith(BRANCH_PERMISSION_PREFIX))
          .map((permission) => ({ distributor_id: permission.slice(BRANCH_PERMISSION_PREFIX.length) })),
      },
    }))
    return NextResponse.json({ managers, distributors })
  } catch (error) {
    console.error('[AREA MANAGER LIST]', error)
    return NextResponse.json({ error: 'Unable to load Area Managers and branch assignments.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdminOwner()
    if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const body = await req.json()
    const fullName = String(body.full_name || '').trim()
    const username = String(body.username || '').trim().toLowerCase()
    const mobile = String(body.mobile || '').trim()
    const email = String(body.email || '').trim() || null
    const password = String(body.password || '')
    const requestedIds = assignmentIds(body.distributor_ids)
    const distributorIds = await validDistributorIds(requestedIds)
    if (!fullName || !/^[a-z0-9._-]{3,}$/.test(username) || !/^[0-9+() -]{7,20}$/.test(mobile) || password.length < 12) {
      return NextResponse.json({ error: 'Enter a valid name, username, mobile number, and temporary password of at least 12 characters.' }, { status: 400 })
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    if (!requestedIds.length || distributorIds.length !== requestedIds.length) return NextResponse.json({ error: 'Assign at least one valid active Hiroma Branch. City Distributor franchisees cannot be assigned to Area Managers.' }, { status: 400 })
    if (await prisma.user.findUnique({ where: { username }, select: { id: true } })) return NextResponse.json({ error: 'Username is already in use.' }, { status: 409 })

    const passwordHash = await hashPassword(password)
    const manager = await prisma.$transaction(async (tx) => {
      const memberId = await generateMemberId(tx)
      const user = await tx.user.create({
        data: {
          member_id: memberId, full_name: fullName, username, mobile, email, password_hash: passwordHash,
          role: 'staff', status: 'active', created_by: admin.id, password_change_required: true,
          password_is_temporary: true, password_prompt_due_at: new Date(),
        },
      })
      const profile = await tx.staffProfile.create({ data: { user_id: user.id, owner_id: admin.id, staff_type: 'area_manager', permissions: ['area_audits', ...distributorIds.map((id) => `${BRANCH_PERMISSION_PREFIX}${id}`)] } })
      return { id: profile.id, user_id: user.id }
    })
    const { ip_address, device } = getClientInfo(req)
    createAuditLog({ user_id: admin.id, user_name: admin.full_name, user_role: admin.role, member_id: formatMemberId(admin.id, admin.role), activity_type: 'area_manager_created', category: 'admin', description: `${admin.full_name} created Area Manager ${fullName}`, metadata: { area_manager_id: manager.user_id, distributor_ids: distributorIds }, ip_address, device, status: 'completed' })
    return NextResponse.json({ success: true, manager }, { status: 201 })
  } catch (error) {
    console.error('[AREA MANAGER CREATE]', error)
    return NextResponse.json({ error: 'Unable to create the Area Manager account.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdminOwner()
    if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const body = await req.json()
    const profileId = String(body.id || '')
    const profile = await prisma.staffProfile.findFirst({ where: { id: profileId, owner_id: admin.id, staff_type: 'area_manager' }, select: { id: true, user_id: true, permissions: true } })
    if (!profile) return NextResponse.json({ error: 'Area Manager account not found.' }, { status: 404 })
    const requestedIds = body.distributor_ids === undefined ? null : assignmentIds(body.distributor_ids)
    const distributorIds = requestedIds === null ? null : await validDistributorIds(requestedIds)
    if (requestedIds && (!requestedIds.length || distributorIds?.length !== requestedIds.length)) return NextResponse.json({ error: 'Select at least one valid active assignment.' }, { status: 400 })
    const isActive = typeof body.is_active === 'boolean' ? body.is_active : undefined

    await prisma.$transaction(async (tx) => {
      if (distributorIds) await tx.staffProfile.update({ where: { id: profile.id }, data: { permissions: ['area_audits', ...distributorIds.map((id) => `${BRANCH_PERMISSION_PREFIX}${id}`)] } })
      if (isActive !== undefined) {
        await tx.staffProfile.update({ where: { id: profile.id }, data: { is_active: isActive } })
        await tx.user.update({ where: { id: profile.user_id }, data: { status: isActive ? 'active' : 'inactive' } })
      }
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[AREA MANAGER UPDATE]', error)
    return NextResponse.json({ error: 'Unable to update the Area Manager account.' }, { status: 500 })
  }
}
