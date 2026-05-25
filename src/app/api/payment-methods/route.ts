import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = req.nextUrl
    const user_id = searchParams.get('user_id') || ''
    const status  = searchParams.get('status')  || 'all'

    let methods: any[]

    if (user.role === 'city') {
      // If user_id param — return that user's approved methods (supplier's methods)
      // Otherwise — return own methods
      const targetId = user_id || user.id
      const statusFilter = user_id ? `AND pm.status = 'approved'` : (status !== 'all' ? `AND pm.status = '${status}'` : '')
      methods = await prisma.$queryRawUnsafe(`
        SELECT pm.*, u.full_name, u.username, u.role
        FROM payment_methods pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.user_id = '${targetId}'
        ${statusFilter}
        ORDER BY pm.created_at DESC
      `)
    } else if (user.role === 'admin') {
      methods = await prisma.$queryRawUnsafe(`
        SELECT pm.*, u.full_name, u.username, u.role
        FROM payment_methods pm
        JOIN users u ON u.id = pm.user_id
        WHERE 1=1
        ${user_id ? `AND pm.user_id = '${user_id}'` : ''}
        ${status !== 'all' ? `AND pm.status = '${status}'` : ''}
        ORDER BY pm.created_at DESC
      `)
    } else if (user.role === 'provincial' || user.role === 'regional') {
      // If user_id param provided — fetch that user's approved methods (e.g. supplier's methods)
      // Otherwise — fetch own methods
      const targetId = user_id || user.id
      const statusFilter = user_id ? `AND pm.status = 'approved'` : (status !== 'all' ? `AND pm.status = '${status}'` : '')
      methods = await prisma.$queryRawUnsafe(`
        SELECT pm.*, u.full_name, u.username, u.role
        FROM payment_methods pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.user_id = '${targetId}'
        ${statusFilter}
        ORDER BY pm.created_at DESC
      `)
    } else if (user.role === 'reseller') {
      // Reseller fetches approved methods of their city dist
      if (!user_id) return NextResponse.json({ methods: [] })
      console.log('[PAYMENT METHODS] Reseller fetching for city dist:', user_id)
      methods = await prisma.$queryRawUnsafe(`
        SELECT pm.*
        FROM payment_methods pm
        WHERE pm.user_id = '${user_id}'
        AND pm.status = 'approved'
        ORDER BY pm.type ASC
      `)
      console.log('[PAYMENT METHODS] Found methods:', methods.length)
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Format user info
    const formatted = methods.map((m: any) => ({
      id:             m.id,
      type:           m.type,
      account_name:   m.account_name,
      account_number: m.account_number,
      bank_name:      m.bank_name || null,
      status:         m.status,
      created_at:     m.created_at,
      updated_at:     m.updated_at,
      user: m.full_name ? {
        full_name: m.full_name,
        username:  m.username,
        role:      m.role,
      } : undefined,
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
    if (!user || !['city', 'provincial', 'regional', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { type, account_name, account_number, bank_name } = await req.json()

    if (!type || !account_name || !account_number) {
      return NextResponse.json({ error: 'type, account_name and account_number are required.' }, { status: 400 })
    }

    if (!['gcash', 'bank_transfer'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type.' }, { status: 400 })
    }

    if (type === 'bank_transfer' && !bank_name) {
      return NextResponse.json({ error: 'bank_name is required for bank transfer.' }, { status: 400 })
    }

    // Check if already has same type pending or approved
    const existing: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, status FROM payment_methods
      WHERE user_id = '${user.id}' AND type = '${type}'
      AND status IN ('pending', 'approved')
      LIMIT 1
    `)

    if (existing.length > 0) {
      const label = type === 'gcash' ? 'GCash' : 'Bank Transfer'
      return NextResponse.json({
        error: `You already have a ${label} method ${existing[0].status === 'pending' ? 'pending approval' : 'approved'}.`,
      }, { status: 400 })
    }

    const id = crypto.randomUUID()
    await prisma.$executeRawUnsafe(`
      INSERT INTO payment_methods (id, user_id, type, account_name, account_number, bank_name, status, created_at, updated_at)
      VALUES ('${id}', '${user.id}', '${type}', '${account_name.trim()}', '${account_number.trim()}', ${bank_name ? `'${bank_name.trim()}'` : 'NULL'}, '${user.role === 'admin' ? 'approved' : 'pending'}', NOW(), NOW())
    `)

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

    await prisma.$executeRawUnsafe(`
      UPDATE payment_methods SET status = '${status}', updated_at = NOW() WHERE id = '${id}'
    `)

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
    if (!user || !['city', 'provincial', 'regional', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required.' }, { status: 400 })

    await prisma.$executeRawUnsafe(`
      DELETE FROM payment_methods WHERE id = '${id}' AND user_id = '${user.id}'
    `)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[PAYMENT METHODS DELETE]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}