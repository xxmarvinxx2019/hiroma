import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── PUT update product ──
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { name, description, type, price, image_url } = await req.json()

    if (!name || !price) {
      return NextResponse.json({ error: 'Name and price are required.' }, { status: 400 })
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        type,
        price,
        image_url: image_url?.trim() || null,
      },
    })

    return NextResponse.json({ success: true, product })
  } catch (error) {
    console.error('[UPDATE PRODUCT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH toggle active status ──
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { is_active } = await req.json()

    const product = await prisma.product.update({
      where: { id },
      data: { is_active },
    })

    return NextResponse.json({ success: true, product })
  } catch (error) {
    console.error('[TOGGLE PRODUCT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}