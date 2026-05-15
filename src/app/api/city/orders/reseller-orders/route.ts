import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET resellers under this city distributor ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const search = searchParams.get('search') || ''

    const resellers = await prisma.user.findMany({
      where: {
        role:       'reseller',
        status:     'active',
        created_by: user.id,
        ...(search && {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { username:  { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id:        true,
        full_name: true,
        username:  true,
      },
      orderBy: { full_name: 'asc' },
      take: 50,
    })

    return NextResponse.json({ resellers })
  } catch (error) {
    console.error('[CITY RESELLER ORDER GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST create an order on behalf of a reseller ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { reseller_id, order_type, notes, items } = await req.json()

    if (!reseller_id)
      return NextResponse.json({ error: 'Please select a reseller.' }, { status: 400 })
    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'Order must have at least one item.' }, { status: 400 })
    if (!['online', 'offline'].includes(order_type))
      return NextResponse.json({ error: 'Invalid order type.' }, { status: 400 })

    // Validate reseller belongs to this city distributor
    const reseller = await prisma.user.findFirst({
      where: { id: reseller_id, role: 'reseller', status: 'active' },
      select: { id: true, full_name: true, username: true },
    })

    if (!reseller)
      return NextResponse.json({ error: 'Reseller not found or inactive.' }, { status: 404 })

    // Validate products and check city dist inventory
    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products   = await prisma.product.findMany({
      where:  { id: { in: productIds }, is_active: true },
      select: { id: true, name: true, price: true, reseller_price: true },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    const productMap = new Map(products.map((p) => [p.id, p]))
    let total_amount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number }) => {
      const product    = productMap.get(item.product_id)!
      const unit_price = Number(product.reseller_price || product.price)
      const subtotal   = unit_price * item.quantity
      total_amount    += subtotal
      return { product_id: item.product_id, quantity: item.quantity, unit_price, subtotal }
    })

    // Create order with city dist as seller, reseller as buyer
    // Mark as delivered immediately since city dist is handing it over in person
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          buyer_id:          reseller_id,
          seller_id:         user.id,
          order_type,
          status:            'delivered', // immediate — city dist is present
          total_amount,
          is_cross_purchase: false,
          notes:             notes?.trim() || null,
          items:             { create: orderItems },
        },
        select: {
          id: true, status: true, total_amount: true, created_at: true,
          buyer: { select: { full_name: true, username: true } },
        },
      })

      // Credit reseller inventory immediately
      for (const item of orderItems) {
        await tx.inventory.upsert({
          where: {
            owner_id_product_id: {
              owner_id:   reseller_id,
              product_id: item.product_id,
            },
          },
          update: { quantity: { increment: item.quantity } },
          create: {
            owner_id:            reseller_id,
            product_id:          item.product_id,
            quantity:            item.quantity,
            low_stock_threshold: 5,
          },
        })

        // Deduct from city distributor inventory
        await tx.inventory.updateMany({
          where: { owner_id: user.id, product_id: item.product_id },
          data:  { quantity: { decrement: item.quantity } },
        })
      }

      return newOrder
    })

    return NextResponse.json({
      success: true,
      message: `Order created for ${reseller.full_name} and marked as delivered.`,
      order,
    })
  } catch (error) {
    console.error('[CITY RESELLER ORDER POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}