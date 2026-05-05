import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const items = await prisma.inventory.findMany({
      where: {
        owner_id: user.id,
        quantity: { lte: prisma.inventory.fields.low_stock_threshold },
      },
      select: {
        id: true,
        quantity: true,
        low_stock_threshold: true,
        product: { select: { name: true, type: true } },
      },
      orderBy: { quantity: 'asc' },
      take: 5,
    })

    return NextResponse.json({ items })
  } catch (error) {
    console.error('[LOW STOCK ERROR]', error)
    // Fallback query without field reference
    try {
      const user2 = await getCurrentUser()
      const allItems = await prisma.inventory.findMany({
        where: { owner_id: user2!.id },
        select: {
          id: true,
          quantity: true,
          low_stock_threshold: true,
          product: { select: { name: true, type: true } },
        },
      })
      const lowItems = allItems
        .filter((i) => i.quantity <= i.low_stock_threshold)
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 5)
      return NextResponse.json({ items: lowItems })
    } catch {
      return NextResponse.json({ items: [] })
    }
  }
}