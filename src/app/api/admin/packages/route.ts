import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET all packages ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))
    const search   = searchParams.get('search') || ''

    const active = searchParams.get('active') === 'true'
    const where: Record<string, unknown> = {
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
      ...(active && { is_active: true }),
    }

    const total = await prisma.package.count({ where })
    const packages = await prisma.package.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        products: {
          include: {
            product: {
              select: { name: true, price: true, reseller_price: true },
            },
          },
        },
      },
    })

    return NextResponse.json({ packages, meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } })
  } catch (error) {
    console.error('[GET PACKAGES ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST create package ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      name,
      price,
      direct_referral_bonus,
      pairing_bonus_value,
      point_php_value,
      point_reset_days,
      products,
    } = await req.json()

    if (!name || !price || !direct_referral_bonus || !pairing_bonus_value || !point_php_value) {
      return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 })
    }

    const pkg = await prisma.$transaction(async (tx) => {
      const newPkg = await tx.package.create({
        data: {
          name: name.trim(),
          price,
          direct_referral_bonus,
          pairing_bonus_value,
          point_php_value,
          point_reset_days: point_reset_days || 30,
          is_active: true,
        },
      })

      if (products && products.length > 0) {
        await tx.packageProduct.createMany({
          data: products
            .filter((p: { product_id: string; quantity: number }) => p.product_id)
            .map((p: { product_id: string; quantity: number }) => ({
              package_id: newPkg.id,
              product_id: p.product_id,
              quantity: p.quantity || 1,
            })),
        })
      }

      return newPkg
    })

    return NextResponse.json({ success: true, package: pkg })
  } catch (error) {
    console.error('[CREATE PACKAGE ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}