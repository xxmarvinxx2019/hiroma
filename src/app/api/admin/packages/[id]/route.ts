import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── PUT update package ──
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
    const {
      name,
      price,
      direct_referral_bonus,
      pairing_bonus_value,
      point_php_value,
      point_reset_days,
      daily_product_pairing_cap,
      product_binary_cap_enabled,
      direct_referral_cap_enabled,
      daily_referral_cap,
      binary_pair_cap_enabled,
      daily_binary_pair_cap,
      products,
    } = await req.json()
    const productBinaryCapEnabled =
      typeof product_binary_cap_enabled === 'boolean' ? product_binary_cap_enabled : null

    const pkg = await prisma.$transaction(async (tx) => {
      const updated = await tx.package.update({
        where: { id },
        data: {
          name: name.trim(),
          price,
          direct_referral_bonus,
          pairing_bonus_value,
          point_php_value,
          point_reset_days: point_reset_days || 30,
        },
      })

      // ── Replace all package products ──
      await tx.packageProduct.deleteMany({ where: { package_id: id } })

      if (products && products.length > 0) {
        await tx.packageProduct.createMany({
          data: products
            .filter((p: { product_id: string; quantity: number }) => p.product_id)
            .map((p: { product_id: string; quantity: number }) => ({
              package_id: id,
              product_id: p.product_id,
              quantity: p.quantity || 1,
            })),
        })
      }

      return updated
    })

    // Update package-level caps via raw SQL (not in Prisma schema)
    await prisma.$executeRaw`
      UPDATE packages
      SET daily_product_pairing_cap = ${daily_product_pairing_cap || 50},
          product_binary_cap_enabled = COALESCE(${productBinaryCapEnabled}, product_binary_cap_enabled),
          direct_referral_cap_enabled = ${direct_referral_cap_enabled !== false},
          daily_referral_cap = ${Math.max(1, Number(daily_referral_cap) || 10)},
          binary_pair_cap_enabled = ${binary_pair_cap_enabled !== false},
          daily_binary_pair_cap = ${Math.max(1, Number(daily_binary_pair_cap) || 10)}
      WHERE id::text = ${id}
    `

    return NextResponse.json({ success: true, package: pkg })
  } catch (error) {
    console.error('[UPDATE PACKAGE ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH toggle active ──
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

    await prisma.package.update({
      where: { id },
      data: { is_active },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[TOGGLE PACKAGE ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
