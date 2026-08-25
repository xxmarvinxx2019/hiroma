import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { generateMemberId } from '@/app/lib/memberId'
import {
  getSensitiveResellerPinFailure,
  isSensitiveResellerPinAccepted,
  verifyResellerSecurityPin,
} from '@/app/lib/resellerSecurityPin'
import {
  createRequiredAuditLog,
  formatMemberId,
  getClientInfo,
} from '@/app/lib/auditLog'

// ── GET all distributors ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const parentLevel = searchParams.get('parent_level') || ''
    const search = searchParams.get('search') || ''
    const level = searchParams.get('level') || 'all'
    const excludeBranches = searchParams.get('exclude_branches') === 'true'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const validLevels = ['regional', 'provincial', 'city', 'branch']

    const levels = parentLevel
      ? parentLevel.split(',').filter((item) => validLevels.includes(item))
      : level !== 'all' && validLevels.includes(level)
        ? [level]
        : validLevels

    const safeLevels = (levels.length > 0 ? levels : validLevels).filter(
      (item) => !(excludeBranches && item === 'branch'),
    )
    const roles = [
      ...new Set(safeLevels.map((item) => (item === 'branch' ? 'city' : item))),
    ]

    const where: any = {
      role: { in: roles },
      distributor_profile: { dist_level: { in: safeLevels as any } },
      ...(search && {
        OR: [
          { full_name: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { mobile: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
          {
            distributor_profile: {
              coverage_area: { contains: search, mode: 'insensitive' },
            },
          },
          {
            distributor_profile: {
              region_name: { contains: search, mode: 'insensitive' },
            },
          },
          {
            distributor_profile: {
              province_name: { contains: search, mode: 'insensitive' },
            },
          },
          {
            distributor_profile: {
              city_muni_name: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      }),
    }

    const total = await prisma.user.count({ where })

    const distributors = await prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        full_name: true,
        username: true,
        mobile: true,
        address: true,
        status: true,
        created_at: true,
        distributor_profile: {
          select: {
            id: true,
            dist_level: true,
            coverage_area: true,
            is_active: true,
            contract_signed_at: true,
            region_code: true,
            region_name: true,
            province_code: true,
            province_name: true,
            city_muni_name: true,
            fulfillment_latitude: true,
            fulfillment_longitude: true,
            parent: {
              select: {
                user: { select: { full_name: true, username: true } },
                dist_level: true,
                coverage_area: true,
              },
            },
          },
        },
      },
    })

    // Overall totals — NOT affected by filter
    const [totalRegional, totalProvincial, totalCity, totalBranch] =
      await Promise.all([
        prisma.user.count({ where: { role: 'regional' } }),
        prisma.user.count({ where: { role: 'provincial' } }),
        prisma.distributorProfile.count({ where: { dist_level: 'city' } }),
        prisma.distributorProfile.count({ where: { dist_level: 'branch' } }),
      ])

    // Fetch sales total per distributor via raw SQL
    const distIds = distributors.map((d) => d.id)
    const salesRaw =
      distIds.length > 0
        ? await prisma.$queryRaw<{ seller_id: string; total: number }[]>`
          SELECT seller_id::text, COALESCE(SUM(total_amount), 0)::float AS total
          FROM orders
          WHERE seller_id::text = ANY(${distIds}::text[]) AND status = 'delivered'
          GROUP BY seller_id
        `
        : []
    const salesMap = new Map(
      salesRaw.map((s) => [s.seller_id, Number(s.total)]),
    )

    const distributorsWithSales = distributors.map((d) => ({
      ...d,
      sales_total: salesMap.get(d.id) || 0,
    }))

    // Include admin as a parent option (fallback)
    const adminUser = await prisma.user.findFirst({
      where: { role: 'admin' },
      select: { id: true, full_name: true, username: true },
    })

    return NextResponse.json({
      distributors: distributorsWithSales,
      adminUser,
      totals: {
        regional: totalRegional,
        provincial: totalProvincial,
        city: totalCity,
        branch: totalBranch,
      },
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error('[GET DISTRIBUTORS ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong.' },
      { status: 500 },
    )
  }
}

// ── POST create new distributor ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      full_name,
      username,
      email,
      mobile,
      password,
      address,
      dist_level,
      parent_dist_id,
      region_code,
      region_name,
      province_code,
      province_name,
      city_muni_code,
      city_muni_name,
      barangay_code,
      barangay_name,
      street_address,
      zip_code,
    } = body

    if (
      !full_name ||
      !username ||
      !email?.trim() ||
      !mobile ||
      !password ||
      !dist_level
    ) {
      return NextResponse.json(
        { error: 'All required fields must be filled.' },
        { status: 400 },
      )
    }

    // Check email uniqueness if provided
    if (email?.trim()) {
      const existingEmail = await prisma.user.findFirst({
        where: { email: email.trim().toLowerCase() },
      })
      if (existingEmail) {
        return NextResponse.json(
          { error: 'Email is already in use.' },
          { status: 400 },
        )
      }
    }

    if (!region_code || !region_name) {
      return NextResponse.json(
        { error: 'Region is required.' },
        { status: 400 },
      )
    }
    if (
      !province_code ||
      (province_code !== 'DIRECT' && !province_name) ||
      !city_muni_code ||
      !city_muni_name ||
      !barangay_code ||
      !barangay_name ||
      !street_address?.trim() ||
      !/^\d{4}$/.test(String(zip_code || ''))
    ) {
      return NextResponse.json(
        {
          error:
            'Complete Province, City/Municipality, Barangay, street address, and a valid 4-digit ZIP code are required.',
        },
        { status: 400 },
      )
    }

    // Coverage is based on the appointed distributor level; the User address remains complete.
    const coverageParts =
      dist_level === 'regional'
        ? [region_name]
        : dist_level === 'provincial'
          ? [province_name, region_name]
          : [city_muni_name, province_name, region_name]
    const coverage_area = coverageParts.filter(Boolean).join(', ')

    const existing = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'Username already taken.' },
        { status: 400 },
      )
    }

    // If admin user ID was sent as parent, clear it — admin has no distributor profile
    let resolvedParentId = parent_dist_id || null
    if (resolvedParentId) {
      const adminUser = await prisma.user.findFirst({
        where: { role: 'admin' },
        select: { id: true },
      })
      if (adminUser && resolvedParentId === adminUser.id) {
        resolvedParentId = null // admin is the supplier, not a parent dist
      }
    }

    console.log('[DISTRIBUTOR REG] resolved parent_dist_id:', resolvedParentId)

    // Validate parent only if one is explicitly provided
    if (resolvedParentId) {
      const parentProfile = await prisma.distributorProfile.findUnique({
        where: { id: resolvedParentId },
        select: { dist_level: true, is_active: true },
      })
      if (!parentProfile) {
        console.error(
          '[DISTRIBUTOR REG] Parent profile not found for id:',
          resolvedParentId,
        )
        return NextResponse.json(
          { error: 'Parent distributor not found.' },
          { status: 400 },
        )
      }
      if (!parentProfile.is_active) {
        return NextResponse.json(
          { error: 'Parent distributor is inactive.' },
          { status: 400 },
        )
      }
      if (
        dist_level === 'provincial' &&
        parentProfile.dist_level !== 'regional'
      ) {
        return NextResponse.json(
          {
            error: 'Provincial must be assigned under a regional distributor.',
          },
          { status: 400 },
        )
      }
      if (
        ['city', 'branch'].includes(dist_level) &&
        !['provincial', 'regional'].includes(parentProfile.dist_level)
      ) {
        return NextResponse.json(
          {
            error:
              'City distributors and branches must be assigned under a provincial or regional distributor.',
          },
          { status: 400 },
        )
      }
    }

    const roleMap: Record<string, string> = {
      regional: 'regional',
      provincial: 'provincial',
      city: 'city',
      branch: 'city',
    }
    const role = roleMap[dist_level]
    if (!role) {
      return NextResponse.json(
        { error: 'Invalid distributor level.' },
        { status: 400 },
      )
    }

    const hashedPassword = await hashPassword(password)

    const newDist = await prisma.$transaction(async (tx) => {
      const memberId = await generateMemberId(tx)
      const newUser = await tx.user.create({
        data: {
          member_id: memberId,
          username: username.trim().toLowerCase(),
          full_name: full_name.trim(),
          mobile: mobile.trim(),
          password_hash: hashedPassword,
          role: role as any,
          status: 'active',
          address: address?.trim() || null,
          zip_code: String(zip_code),
          street_address: street_address.trim(),
          region_code: String(region_code),
          region_name: String(region_name),
          province_code:
            province_code === 'DIRECT' ? null : String(province_code),
          province_name:
            province_code === 'DIRECT' ? null : String(province_name),
          city_muni_code: String(city_muni_code),
          city_muni_name: String(city_muni_name),
          barangay_code: String(barangay_code),
          barangay_name: String(barangay_name),
          created_by: user.id,
        },
      })

      await tx.distributorProfile.create({
        data: {
          user_id: newUser.id,
          dist_level: dist_level as any,
          coverage_area: coverage_area,
          parent_dist_id: resolvedParentId,
          contract_signed_at: new Date(),
          is_active: true,
          region_code: region_code || null,
          region_name: region_name || null,
          province_code:
            dist_level === 'regional' || province_code === 'DIRECT'
              ? null
              : province_code || null,
          province_name:
            dist_level === 'regional' || province_code === 'DIRECT'
              ? null
              : province_name || null,
          city_muni_code: ['city', 'branch'].includes(dist_level)
            ? city_muni_code || null
            : null,
          city_muni_name: ['city', 'branch'].includes(dist_level)
            ? city_muni_name || null
            : null,
        },
      })

      await tx.wallet.create({
        data: {
          user_id: newUser.id,
          balance: 0,
          total_earned: 0,
          total_withdrawn: 0,
        },
      })

      return newUser
    })

    return NextResponse.json({
      success: true,
      message: 'Distributor registered successfully.',
      distributor: { id: newDist.id, username: newDist.username },
    })
  } catch (error) {
    console.error('[CREATE DISTRIBUTOR ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong.' },
      { status: 500 },
    )
  }
}
// ── PATCH edit distributor / assign parent / toggle status ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      distributor_id,
      action,
      parent_dist_id,
      full_name,
      mobile,
      address,
      email,
      coverage_area,
      fulfillment_latitude,
      fulfillment_longitude,
    } = body

    if (!distributor_id) {
      return NextResponse.json(
        { error: 'distributor_id is required.' },
        { status: 400 },
      )
    }

    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: distributor_id },
      select: { dist_level: true, id: true },
    })
    if (!profile) {
      return NextResponse.json(
        { error: 'Distributor not found.' },
        { status: 404 },
      )
    }

    // ── Toggle status (activate/deactivate) ──
    if (action === 'toggle_status') {
      const current = await prisma.user.findUnique({
        where: { id: distributor_id },
        select: { status: true },
      })
      const newStatus = current?.status === 'active' ? 'inactive' : 'active'
      await Promise.all([
        prisma.user.update({
          where: { id: distributor_id },
          data: { status: newStatus },
        }),
        prisma.distributorProfile.update({
          where: { user_id: distributor_id },
          data: { is_active: newStatus === 'active' },
        }),
      ])
      return NextResponse.json({
        success: true,
        message: `Distributor ${newStatus === 'active' ? 'activated' : 'deactivated'}.`,
        status: newStatus,
      })
    }

    // ── Reset password ──
    if (action === 'reset_password') {
      if (user.is_staff) {
        return NextResponse.json(
          { error: 'Only the admin owner can reset distributor passwords.' },
          { status: 403 },
        )
      }
      const { password, security_pin } = body
      if (typeof password !== 'string' || password.length < 8) {
        return NextResponse.json(
          { error: 'Password must contain at least 8 characters.' },
          { status: 400 },
        )
      }
      const pinVerification = await verifyResellerSecurityPin(
        user.id,
        security_pin,
      )
      if (!isSensitiveResellerPinAccepted(pinVerification)) {
        const failure = getSensitiveResellerPinFailure(pinVerification)
        return NextResponse.json(
          { error: failure.error },
          { status: failure.status },
        )
      }
      const hashed = await hashPassword(password)
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: distributor_id },
          data: { password_hash: hashed, password_changed_at: new Date() },
        })
        const revoked = await tx.passkeyCredential.deleteMany({
          where: { user_id: distributor_id },
        })
        await createRequiredAuditLog(tx, {
          user_id: user.id,
          user_name: user.full_name,
          user_role: 'admin',
          member_id: formatMemberId(user.id, 'admin'),
          activity_type: 'distributor_password_reset',
          category: 'distributor',
          description:
            'Admin owner confirmed a distributor password reset with the Security PIN.',
          metadata: {
            distributor_id,
            revoked_passkey_count: revoked.count,
            distributor_sessions_revoked: true,
          },
          risk_level: 'high',
          status: 'completed',
          ...getClientInfo(req),
        })
        return revoked
      })
      return NextResponse.json({
        success: true,
        message: 'Password reset successfully.',
      })
    }

    // ── Edit profile ──
    if (action === 'edit') {
      const currentDistributor = await prisma.user.findUnique({
        where: { id: distributor_id },
        select: { email: true, mobile: true },
      })
      if (!currentDistributor) {
        return NextResponse.json(
          { error: 'Distributor not found.' },
          { status: 404 },
        )
      }
      const requestedEmail =
        typeof email === 'string' && email.trim()
          ? email.trim().toLowerCase()
          : currentDistributor.email
      const requestedMobile =
        typeof mobile === 'string' && mobile.trim()
          ? mobile.trim()
          : currentDistributor.mobile
      const changesSensitiveContact =
        requestedEmail !== currentDistributor.email ||
        requestedMobile !== currentDistributor.mobile
      if (changesSensitiveContact) {
        if (user.is_staff) {
          return NextResponse.json(
            {
              error:
                'Only the admin owner can change distributor email or mobile.',
            },
            { status: 403 },
          )
        }
        const pinVerification = await verifyResellerSecurityPin(
          user.id,
          body.security_pin,
        )
        if (!isSensitiveResellerPinAccepted(pinVerification)) {
          const failure = getSensitiveResellerPinFailure(pinVerification)
          return NextResponse.json(
            { error: failure.error },
            { status: failure.status },
          )
        }
      }
      const updates: any = {}
      if (full_name) updates.full_name = full_name.trim()
      if (mobile) updates.mobile = requestedMobile
      if (address) updates.address = address.trim()
      if (email) updates.email = requestedEmail

      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: distributor_id }, data: updates })
        if (coverage_area) {
          const latitude = fulfillment_latitude === '' || fulfillment_latitude == null ? null : Number(fulfillment_latitude)
          const longitude = fulfillment_longitude === '' || fulfillment_longitude == null ? null : Number(fulfillment_longitude)
          if ((latitude === null) !== (longitude === null) || (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude! < -180 || longitude! > 180))) {
            throw new Error('INVALID_FULFILLMENT_COORDINATES')
          }
          await tx.distributorProfile.update({
            where: { user_id: distributor_id },
            data: { coverage_area, fulfillment_latitude: latitude, fulfillment_longitude: longitude },
          })
        }
        if (changesSensitiveContact) {
          await createRequiredAuditLog(tx, {
            user_id: user.id,
            user_name: user.full_name,
            user_role: 'admin',
            member_id: formatMemberId(user.id, 'admin'),
            activity_type: 'distributor_sensitive_contact_updated',
            category: 'distributor',
            description:
              'Admin owner confirmed a distributor email or mobile change with the Security PIN.',
            metadata: {
              distributor_id,
              protected_fields: [
                ...(requestedEmail !== currentDistributor.email
                  ? ['email']
                  : []),
                ...(requestedMobile !== currentDistributor.mobile
                  ? ['mobile']
                  : []),
              ],
            },
            risk_level: 'medium',
            status: 'completed',
            ...getClientInfo(req),
          })
        }
      })
      return NextResponse.json({
        success: true,
        message: 'Distributor updated successfully.',
      })
    }

    // ── Assign parent ──
    if (!parent_dist_id) {
      await prisma.distributorProfile.update({
        where: { user_id: distributor_id },
        data: { parent_dist_id: null },
      })
      return NextResponse.json({
        success: true,
        message: 'Parent removed successfully.',
      })
    }

    const parentProfile = await prisma.distributorProfile.findUnique({
      where: { id: parent_dist_id },
      select: { dist_level: true, is_active: true, user_id: true },
    })
    if (!parentProfile)
      return NextResponse.json(
        { error: 'Parent distributor not found.' },
        { status: 404 },
      )
    if (!parentProfile.is_active)
      return NextResponse.json(
        { error: 'Parent distributor is inactive.' },
        { status: 400 },
      )
    if (parentProfile.user_id === distributor_id)
      return NextResponse.json(
        { error: 'Cannot assign as own parent.' },
        { status: 400 },
      )
    if (
      profile.dist_level === 'provincial' &&
      parentProfile.dist_level !== 'regional'
    )
      return NextResponse.json(
        { error: 'Provincial must be under a regional distributor.' },
        { status: 400 },
      )
    if (
      ['city', 'branch'].includes(profile.dist_level) &&
      !['provincial', 'regional'].includes(parentProfile.dist_level)
    )
      return NextResponse.json(
        {
          error:
            'City distributors and branches must be under a provincial or regional distributor.',
        },
        { status: 400 },
      )
    if (profile.dist_level === 'regional')
      return NextResponse.json(
        { error: 'Regional distributors cannot have a parent.' },
        { status: 400 },
      )

    await prisma.distributorProfile.update({
      where: { user_id: distributor_id },
      data: { parent_dist_id },
    })
    return NextResponse.json({
      success: true,
      message: 'Parent assigned successfully.',
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_FULFILLMENT_COORDINATES') return NextResponse.json({ error: 'Enter a valid latitude and longitude pair.' }, { status: 400 })
    console.error('[ADMIN DISTRIBUTORS PATCH ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong.' },
      { status: 500 },
    )
  }
}
