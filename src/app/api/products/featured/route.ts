import { NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'

// Public endpoint — no auth required
// Returns first 3 active products for the landing page
export async function GET() {
  try {
    const products = await prisma.product.findMany({
      where:   { is_active: true },
      orderBy: { created_at: 'asc' },
      take:    3,
      select: {
        id:          true,
        name:        true,
        description: true,
        price:       true,  // SRP
        type:        true,
        image_url:   true,
      },
    })

    return NextResponse.json({ products })
  } catch (error) {
    console.error('[FEATURED PRODUCTS ERROR]', error)
    return NextResponse.json({ products: [] })
  }
}