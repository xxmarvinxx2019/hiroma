import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { verifyResellerSecurityPin } from '@/app/lib/resellerSecurityPin'
import { Role } from '@prisma/client'

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
      status: string; created_at: Date | null; updated_at: Date | null
      user: { full_name: string; username: string; role: Role }
    }>

    // Special case: role=admin — return admin's approved payment methods
    // Used by city dist on PIN request page to know where to send payment
    if (roleParam === 'admin') {
      const adminUser = await prisma.user.findFirst({
        where:  { role: 'admin' },
        select: { id: true },
      })
      if (!adminUser) return NextResponse.json({ methods: [] })
      methods = await prisma.paymentMethod.findMany({
        where: { user_id: adminUser.id, status: 'approved' },
        orderBy: { created_at: 'desc' },
        include: { user: { select: { full_name: true, username: true, role: true } } },
      })
      return NextResponse.json({ methods })
    }

    if (user.role === 'city') {
      // If user_id param — return that user's approved methods (supplier's methods)
      // Otherwise — return own methods
      const targetId = user_id || user.id
      methods = await prisma.paymentMethod.findMany({
        where: { user_id: targetId, status: user_id ? 'approved' : requestedStatus },
        orderBy: { created_at: 'desc' },
        include: { user: { select: { full_name: true, username: true, role: true } } },
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
        include: { user: { select: { full_name: true, username: true, role: true } } },
      })
    } else if (user.role === 'provincial' || user.role === 'regional') {
      // If user_id param provided — fetch that user's approved methods (e.g. supplier's methods)
      // Otherwise — fetch own methods
      const targetId = user_id || user.id
      methods = await prisma.paymentMethod.findMany({
        where: { user_id: targetId, status: user_id ? 'approved' : requestedStatus },
        orderBy: { created_at: 'desc' },
        include: { user: { select: { full_name: true, username: true, role: true } } },
      })
    } else if (user.role === 'reseller') {
      methods = await prisma.paymentMethod.findMany({
        where: { user_id: user.id, ...(requestedStatus ? { status: requestedStatus } : {}) },
        orderBy: { created_at: 'desc' },
        include: { user: { select: { full_name: true, username: true, role: true } } },
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
      created_at:     m.created_at,
      updated_at:     m.updated_at,
      user: m.user,
    }))

    return NextResponse.json({ methods: formatted })
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
      if (!pinVerification.valid) {
        return NextResponse.json({ error: pinVerification.error || 'Security PIN is required.' }, { status: pinVerification.locked ? 429 : 401 })
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

    await prisma.paymentMethod.create({
      data: {
        user_id: user.id,
        type,
        account_name: account_name.trim().replace(/\s+/g, ' '),
        account_number: account_number.trim(),
        bank_name: bank_name?.trim() || null,
        status: user.role === 'admin' ? 'approved' : 'pending',
      },
    })

    return NextResponse.json({ success: true, message: 'Payment method submitted for approval.' })
  } catch (error) {
    console.error('[PAYMENT METHODS POST]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH — admin approves/rejects ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, status } = await req.json()

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
      if (!pinVerification.valid) {
        return NextResponse.json({ error: pinVerification.error || 'Security PIN is required.' }, { status: pinVerification.locked ? 429 : 401 })
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
