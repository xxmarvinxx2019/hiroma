import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    // Find by order_number or id
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { id },
          { order_number: id },
        ],
      },
      select: {
        id:                true,
        order_number:      true,
        status:            true,
        total_amount:      true,
        payment_method:    true,
        payment_reference: true,
        payment_status:    true,
        notes:             true,
        created_at:        true,
        buyer: {
          select: {
            id:        true,
            full_name: true,
            username:  true,
            mobile:    true,
            address:   true,
            role:      true,
          },
        },
        seller: {
          select: {
            id:        true,
            full_name: true,
            username:  true,
            mobile:    true,
            address:   true,
            role:      true,
          },
        },
        items: {
          select: {
            id:        true,
            quantity:   true,
            unit_price: true,
            subtotal:   true,
            product: {
              select: {
                id:   true,
                name: true,
                type: true,
              },
            },
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    // Check access — buyer, seller, or admin can view
    const canView = user.role === 'admin' ||
      order.buyer?.id  === user.id ||
      order.seller?.id === user.id

    if (!canView) {
      return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
    }

    return NextResponse.json({ order })
  } catch (error) {
    console.error('[ORDER DETAIL ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}