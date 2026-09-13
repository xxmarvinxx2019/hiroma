import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import {
  getSensitiveResellerPinFailure,
  isSensitiveResellerPinAccepted,
  verifyResellerSecurityPin,
} from '@/app/lib/resellerSecurityPin'
import { Role } from '@prisma/client'
import { canReadPaymentMethodTarget } from '@/app/lib/paymentMethodAccess'
import { recommendFulfillmentDistributor } from '@/app/lib/orderSecurity'
import { claimPayoutDestinationOwner, PayoutDestinationOwnershipError } from '@/app/lib/payoutDestinationOwner'
import { notifyActiveAdmins } from '@/app/lib/adminRequestNotifications'

async function resolveAuthorizedSupplier(user: { id: string; role: string }, req: NextRequest): Promise<string | null> {
  if (user.role === 'regional') return prisma.user.findFirst({ where: { role: 'admin', status: 'active' }, select: { id: true } }).then((item) => item?.id || null)
  if (user.role === 'city' || user.role === 'provincial') {
    const profile = await prisma.distributorProfile.findUnique({ where: { user_id: user.id }, select: { region_code: true, province_code: true, parent: { select: { user_id: true, is_active: true } } } })
    if (profile?.parent?.is_active) return profile.parent.user_id
    if (user.role === 'city' && profile?.province_code) {
      const provincial = await prisma.distributorProfile.findFirst({ where: { dist_level: 'provincial', province_code: profile.province_code, is_active: true }, select: { user_id: true } })
      if (provincial) return provincial.user_id
    }
    if (profile?.region_code) {
      const regional = await prisma.distributorProfile.findFirst({ where: { dist_level: 'regional', region_code: profile.region_code, is_active: true }, select: { user_id: true } })
      if (regional) return regional.user_id
    }
    return prisma.user.findFirst({ where: { role: 'admin', status: 'active' }, select: { id: true } }).then((item) => item?.id || null)
  }
  if (user.role === 'reseller') {
    const profile = await prisma.resellerProfile.findUnique({ where: { user_id: user.id }, select: { city_dist_id: true } })
    if (!profile?.city_dist_id) return null
    const candidates = await prisma.distributorProfile.findMany({ where: { dist_level: { in: ['city', 'branch'] }, is_active: true, user: { status: 'active' } }, select: { user_id: true, coverage_area: true, region_name: true, province_name: true, city_muni_name: true, barangay_name: true, user: { select: { full_name: true } } } })
    const params = req.nextUrl.searchParams
    return recommendFulfillmentDistributor(candidates.map((candidate) => ({ id: candidate.user_id, full_name: candidate.user.full_name, coverage_area: candidate.coverage_area, region_name: candidate.region_name, province_name: candidate.province_name, city_muni_name: candidate.city_muni_name, barangay_name: candidate.barangay_name })), profile.city_dist_id, { address: params.get('delivery_address') || '', region: params.get('region') || '', province: params.get('province') || '', city: params.get('city') || '', barangay: params.get('barangay') || '' })?.distributor.id || null
  }
  return null
}

// ── GET ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = req.nextUrl
    const user_id   = searchParams.get('user_id') || ''
    const status    = searchParams.get('status')  || 'all'
    const roleParam = searchParams.get('role')    || ''

    const allowedStatuses = ['pending', 'approved', 'rejected']
    const requestedStatus = allowedStatuses.includes(status) ? status : undefined
    let methods: Array<{
      id: string; type: string; account_name: string; account_number: string; bank_name: string | null
      status: string; is_enabled: boolean; created_at: Date | null; updated_at: Date | null
      user: { id: string; full_name: string; username: string; role: Role }
    }>

    // Special case: role=admin — return admin's approved payment methods
    // Used by city dist on PIN request page to know where to send payment
    if (roleParam === 'admin') {
      const adminUser = await prisma.user.findFirst({
        where:  { role: 'admin' },
        select: { id: true },
      })
      if (!adminUser) return NextResponse.json({ methods: [] })
      if (!['admin', 'regional', 'provincial', 'city'].includes(user.role)) return NextResponse.json({ error: 'Payment method access denied.' }, { status: 403 })
      methods = await prisma.paymentMethod.findMany({
        where: { user_id: adminUser.id, status: 'approved' },
        orderBy: { created_at: 'desc' },
        include: { user: { select: { id: true, full_name: true, username: true, role: true } } },
      })
      return NextResponse.json({ methods })
    }

    if (user.role === 'city') {
      // If user_id param — return that user's approved methods (supplier's methods)
      // Otherwise — return own methods
      const targetId = user_id || user.id
      const authorizedSupplierId = await resolveAuthorizedSupplier(user, req)
      if (!canReadPaymentMethodTarget(user.id, user.role, targetId, authorizedSupplierId)) return NextResponse.json({ error: 'Payment method access denied.' }, { status: 403 })
      methods = await prisma.paymentMethod.findMany({
        where: { user_id: targetId, status: user_id ? 'approved' : requestedStatus, ...(user_id ? { is_enabled: true } : {}) },
        orderBy: { created_at: 'desc' },
        include: { user: { select: { id: true, full_name: true, username: true, role: true } } },
      })
    } else if (user.role === 'admin') {
      const allowedRole = Object.values(Role).includes(roleParam as Role)
        ? roleParam as Role
        : undefined
      methods = await prisma.paymentMethod.findMany({
        where: {
          ...(user_id ? { user_id } : {}),
          ...(allowedRole ? { user: { is: { role: allowedRole } } } : {}),
          ...(requestedStatus ? { status: requestedStatus } : {}),
        },
        orderBy: { created_at: 'desc' },
        include: { user: { select: { id: true, full_name: true, username: true, role: true } } },
      })
    } else if (user.role === 'provincial' || user.role === 'regional') {
      // If user_id param provided — fetch that user's approved methods (e.g. supplier's methods)
      // Otherwise — fetch own methods
      const targetId = user_id || user.id
      const authorizedSupplierId = await resolveAuthorizedSupplier(user, req)
      if (!canReadPaymentMethodTarget(user.id, user.role, targetId, authorizedSupplierId)) return NextResponse.json({ error: 'Payment method access denied.' }, { status: 403 })
      methods = await prisma.paymentMethod.findMany({
        where: { user_id: targetId, status: user_id ? 'approved' : requestedStatus, ...(user_id ? { is_enabled: true } : {}) },
        orderBy: { created_at: 'desc' },
        include: { user: { select: { id: true, full_name: true, username: true, role: true } } },
      })
    } else if (user.role === 'reseller') {
      const targetId = user_id || user.id
      const authorizedSupplierId = await resolveAuthorizedSupplier(user, req)
      if (!canReadPaymentMethodTarget(user.id, user.role, targetId, authorizedSupplierId)) return NextResponse.json({ error: 'Payment method access denied.' }, { status: 403 })
      methods = await prisma.paymentMethod.findMany({
        where: { user_id: targetId, ...(user_id ? { status: 'approved', is_enabled: true } : requestedStatus ? { status: requestedStatus } : {}) },
        orderBy: { created_at: 'desc' },
        include: { user: { select: { id: true, full_name: true, username: true, role: true } } },
      })
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Format user info
    const formatted = methods.map((m) => ({
      id:             m.id,
      type:           m.type,
      account_name:   m.account_name,
      account_number: m.account_number,
      bank_name:      m.bank_name || null,
      status:         m.status,
      is_enabled:     m.is_enabled,
      created_at:     m.created_at,
      updated_at:     m.updated_at,
      user: m.user,
    }))

    const outlet = user_id
      ? await prisma.distributorProfile.findUnique({ where: { user_id }, select: { accepts_cash_on_pickup: true } })
      : user.role === 'city'
        ? await prisma.distributorProfile.findUnique({ where: { user_id: user.id }, select: { accepts_cash_on_pickup: true } })
        : null
    return NextResponse.json({ methods: formatted, accepts_cash_on_pickup: outlet?.accepts_cash_on_pickup ?? false })
  } catch (error) {
    console.error('[PAYMENT METHODS GET]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST — city dist registers payment method ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['city', 'provincial', 'regional', 'admin', 'reseller'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { type, account_name, account_number, bank_name, security_pin } = await req.json()

    if (user.role === 'reseller') {
      const pinVerification = await verifyResellerSecurityPin(user.id, security_pin)
      if (!isSensitiveResellerPinAccepted(pinVerification)) {
        const failure = getSensitiveResellerPinFailure(pinVerification)
        return NextResponse.json({ error: failure.error }, { status: failure.status })
      }
    }

    if (!type || !account_name || !account_number) {
      return NextResponse.json({ error: 'type, account_name and account_number are required.' }, { status: 400 })
    }

    if (user.role === 'reseller') {
      const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-PH')
      if (normalizeName(account_name) !== normalizeName(user.full_name)) {
        return NextResponse.json({
          error: 'Account holder name must exactly match your registered Hiroma full name.',
        }, { status: 400 })
      }
    }

    if (!['gcash', 'bank_transfer'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type.' }, { status: 400 })
    }

    if (type === 'gcash' && !/^09\d{9}$/.test(account_number.trim())) {
      return NextResponse.json({
        error: 'GCash mobile number must contain exactly 11 digits and start with 09.',
      }, { status: 400 })
    }

    if (type === 'bank_transfer' && !bank_name) {
      return NextResponse.json({ error: 'bank_name is required for bank transfer.' }, { status: 400 })
    }

    // Check if already has same type pending or approved
    const existing = await prisma.paymentMethod.findFirst({
      where: {
        user_id: user.id,
        type,
        status: { in: ['pending', 'approved'] },
      },
      select: { id: true, status: true },
    })

    if (existing) {
      const label = type === 'gcash' ? 'GCash' : 'Bank Transfer'
      return NextResponse.json({
        error: `You already have a ${label} method ${existing.status === 'pending' ? 'pending approval' : 'approved'}.`,
      }, { status: 400 })
    }

    const methodData = {
      user_id: user.id,
      type,
      account_name: account_name.trim().replace(/\s+/g, ' '),
      account_number: account_number.trim(),
      bank_name: bank_name?.trim() || null,
      status: user.role === 'admin' ? 'approved' : 'pending',
    }
    if (user.role === 'reseller') {
      const identity = await prisma.user.findUnique({ where: { id: user.id }, select: { identity_document_hash: true } })
      if (!identity?.identity_document_hash) return NextResponse.json({ error: 'Complete identity verification before registering a payout account.' }, { status: 403 })
      await prisma.$transaction(async (tx) => {
        await claimPayoutDestinationOwner(tx, { type, bankName: methodData.bank_name, accountNumber: methodData.account_number, identityHash: identity.identity_document_hash!, userId: user.id })
        const created = await tx.paymentMethod.create({ data: methodData })
        await notifyActiveAdmins(tx, {
          type: 'payment_method_submitted',
          title: 'Payout account needs approval',
          message: `${user.full_name || user.username} submitted a ${type === 'gcash' ? 'GCash' : 'bank'} payout account for verification.`,
          entityType: 'payment_method',
          entityId: created.id,
          actionUrl: '/dashboard/admin/payment-methods',
        })
      })
    } else {
      await prisma.$transaction(async (tx) => {
        const created = await tx.paymentMethod.create({ data: methodData })
        if (user.role !== 'admin') {
          await notifyActiveAdmins(tx, {
            type: 'payment_method_submitted',
            title: 'Payment account needs approval',
            message: `${user.full_name || user.username} submitted a ${type === 'gcash' ? 'GCash' : 'bank'} payment account for verification.`,
            entityType: 'payment_method',
            entityId: created.id,
            actionUrl: '/dashboard/admin/payment-methods',
          })
        }
      })
    }

    return NextResponse.json({ success: true, message: 'Payment method submitted for approval.' })
  } catch (error) {
    console.error('[PAYMENT METHODS POST]', error)
    if (error instanceof PayoutDestinationOwnershipError || (error instanceof Error && error.message.includes('permanently registered to another verified person'))) {
      return NextResponse.json({ error: 'This GCash or bank destination belongs to another verified person and cannot be reused.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH — admin approval or outlet acceptance controls ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['admin', 'city'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, status, action, enabled } = await req.json()

    if (user.role === 'city' && action === 'toggle_cash_on_pickup' && typeof enabled === 'boolean') {
      await prisma.distributorProfile.update({ where: { user_id: user.id }, data: { accepts_cash_on_pickup: enabled } })
      return NextResponse.json({ success: true })
    }

    if (user.role === 'city' && action === 'toggle_method' && id && typeof enabled === 'boolean') {
      const updated = await prisma.paymentMethod.updateMany({
        where: { id, user_id: user.id, status: 'approved' },
        data: { is_enabled: enabled },
      })
      if (updated.count !== 1) return NextResponse.json({ error: 'Only your approved payment methods can be enabled.' }, { status: 404 })
      return NextResponse.json({ success: true })
    }

    if (user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    if (!id || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'id and valid status required.' }, { status: 400 })
    }

    await prisma.paymentMethod.update({
      where: { id },
      data: { status },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[PAYMENT METHODS PATCH]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── DELETE — city dist removes own method ──
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['city', 'provincial', 'regional', 'admin', 'reseller'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, security_pin } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required.' }, { status: 400 })

    if (user.role === 'reseller') {
      const pinVerification = await verifyResellerSecurityPin(user.id, security_pin)
      if (!isSensitiveResellerPinAccepted(pinVerification)) {
        const failure = getSensitiveResellerPinFailure(pinVerification)
        return NextResponse.json({ error: failure.error }, { status: failure.status })
      }
    }

    await prisma.paymentMethod.deleteMany({
      where: { id, user_id: user.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[PAYMENT METHODS DELETE]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
