import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { PRODUCT_BINARY_BASE_POINTS } from '@/app/lib/productBinaryQuarter'
import {
  assertRegistrationPinFunding,
  assertUpgradePinFunding,
  normalizeUpgradePaths,
  PackageFundingConfigurationError,
} from '@/app/lib/packageUpgradeConfiguration'

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
      daily_product_pairing_cap,
      product_binary_cap_enabled,
      direct_referral_cap_enabled,
      daily_referral_cap,
      binary_pair_cap_enabled,
      daily_binary_pair_cap,
      products,
      upgrade_paths,
    } = await req.json()
    const productBinaryCapEnabled =
      typeof product_binary_cap_enabled === 'boolean' ? product_binary_cap_enabled : null

    assertRegistrationPinFunding(price, direct_referral_bonus, pairing_bonus_value)
    const normalizedUpgradePaths = normalizeUpgradePaths(upgrade_paths, id)
    const pkg = await prisma.$transaction(async (tx) => {
      // Serialize package-economics edits so source/target validation and the
      // subsequent write cannot race against another admin package update.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('package-upgrade-funding-configuration'))`

      const sourcePackageIds = normalizedUpgradePaths.map((path) => path.from_package_id)
      if (sourcePackageIds.length > 0) {
        const sourcePackages = await tx.package.findMany({
          where: { id: { in: sourcePackageIds }, is_active: true },
          select: { id: true, name: true, direct_referral_bonus: true, pairing_bonus_value: true, price: true },
        })
        if (sourcePackages.length !== sourcePackageIds.length) {
          throw new PackageFundingConfigurationError('One or more upgrade source packages are missing or inactive.')
        }
        const targetPoints = Number(pairing_bonus_value)
        const targetPrice = Number(price)
        if (
          !Number.isFinite(targetPoints) ||
          !Number.isFinite(targetPrice) ||
          sourcePackages.some((source) =>
            Number(source.pairing_bonus_value) >= targetPoints ||
            Number(source.price) >= targetPrice
          )
        ) {
          throw new PackageFundingConfigurationError(
            'Upgrade sources must be lower than the target package in both package value and points.',
          )
        }

        const sourcePackageMap = new Map(sourcePackages.map((source) => [source.id, source]))
        for (const path of normalizedUpgradePaths) {
          const source = sourcePackageMap.get(path.from_package_id)!
          assertUpgradePinFunding(
            path.pin_price,
            source.direct_referral_bonus,
            direct_referral_bonus,
            source.pairing_bonus_value,
            pairing_bonus_value,
            source.name,
          )
        }
      }

      // Editing this package also changes the source side of every existing
      // outbound upgrade. Revalidate those retained paths before committing.
      const outboundUpgradePaths = await tx.packageUpgradePath.findMany({
        where: { from_package_id: id, is_active: true },
        select: {
          pin_price: true,
          to_package: {
            select: {
              name: true,
              price: true,
              direct_referral_bonus: true,
              pairing_bonus_value: true,
            },
          },
        },
      })
      for (const path of outboundUpgradePaths) {
        const target = path.to_package
        if (Number(price) >= Number(target.price)
          || Number(pairing_bonus_value) >= Number(target.pairing_bonus_value)) {
          throw new PackageFundingConfigurationError(
            `This change would make the existing upgrade option to ${target.name} invalid because its source must remain lower in package value and points.`,
          )
        }
        assertUpgradePinFunding(
          path.pin_price,
          direct_referral_bonus,
          target.direct_referral_bonus,
          pairing_bonus_value,
          target.pairing_bonus_value,
          name.trim(),
        )
      }

      const updated = await tx.package.update({
        where: { id },
        data: {
          name: name.trim(),
          price,
          direct_referral_bonus,
          pairing_bonus_value,
          point_php_value: PRODUCT_BINARY_BASE_POINTS,
          point_reset_days: 90,
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

      await tx.packageUpgradePath.deleteMany({ where: { to_package_id: id } })
      for (const path of normalizedUpgradePaths) {
        await tx.packageUpgradePath.create({
          data: {
            from_package_id: path.from_package_id,
            to_package_id: id,
            customer_price: path.customer_price,
            pin_price: path.pin_price,
            products: { create: path.products },
          },
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
    if (error instanceof PackageFundingConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
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
