// src/app/lib/orderNotification.ts
import prisma from '@/app/lib/prisma'
import { broadcastToUser } from '@/app/api/notifications/stream/route'

export async function broadcastNewOrder(orderId: string) {
  try {
    const order = await prisma.order.findUnique({
      where:  { id: orderId },
      select: {
        id: true, order_number: true, total_amount: true, created_at: true,
        buyer:  { select: { id: true, full_name: true, role: true } },
        seller: { select: { id: true, full_name: true, role: true } },
      },
    })
    if (!order) return

    const notification = {
      type:         'new_order',
      order_id:     order.id,
      order_number: order.order_number,
      amount:       Number(order.total_amount),
      buyer_name:   order.buyer.full_name,
      buyer_role:   order.buyer.role,
      seller_id:    order.seller.id,
      created_at:   order.created_at.toISOString(),
    }

    // Notify seller
    broadcastToUser(order.seller.id, notification)

    // Notify admin
    const admin = await prisma.user.findFirst({
      where:  { role: 'admin' },
      select: { id: true },
    })
    if (admin && admin.id !== order.seller.id) {
      broadcastToUser(admin.id, notification)
    }

    // Walk up the chain if seller is city dist
    if (order.seller.role === 'city') {
      const profile = await prisma.distributorProfile.findUnique({
        where:  { user_id: order.seller.id },
        select: {
          parent: {
            select: {
              user_id: true,
              parent: { select: { user_id: true } },
            },
          },
        },
      })
      if (profile?.parent?.user_id) {
        broadcastToUser(profile.parent.user_id, notification) // provincial
      }
      if (profile?.parent?.parent?.user_id) {
        broadcastToUser(profile.parent.parent.user_id, notification) // regional
      }
    }

    // If seller is provincial, notify regional
    if (order.seller.role === 'provincial') {
      const profile = await prisma.distributorProfile.findUnique({
        where:  { user_id: order.seller.id },
        select: { parent: { select: { user_id: true } } },
      })
      if (profile?.parent?.user_id) {
        broadcastToUser(profile.parent.user_id, notification)
      }
    }

    // Notify buyer if reseller
    if (order.buyer.role === 'reseller') {
      broadcastToUser(order.buyer.id, notification)
    }

  } catch (err) {
    console.error('[BROADCAST ORDER ERROR]', err)
  }
}