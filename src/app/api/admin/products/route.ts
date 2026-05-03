import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const products = await prisma.product.findMany({
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ products })
  } catch (error) {
    console.error('[GET PRODUCTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { name, description, type, price, image_url } = await req.json()

    if (!name || !price) {
      return NextResponse.json({ error: 'Name and price are required.' }, { status: 400 })
    }

    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        type: type || 'physical',
        price,
        image_url: image_url?.trim() || null,
        is_active: true,
      },
    })

    return NextResponse.json({ success: true, product })
  } catch (error) {
    console.error('[CREATE PRODUCT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}