import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { calculatePackageEconomics } from '@/app/lib/package-economics'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['city', 'provincial', 'regional', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const upgradeFor = req.nextUrl.searchParams.get('upgrade_for')
    const upgradeProfile = upgradeFor
      ? await prisma.resellerProfile.findFirst({
          where: { user_id: upgradeFor, city_dist_id: user.id },
          select: { package_id: true, package: { select: { pairing_bonus_value: true } } },
        })
      : null
    if (upgradeFor && !upgradeProfile) {
      return NextResponse.json({ error: 'Reseller not found under your account.' }, { status: 404 })
    }

    const packages = await prisma.package.findMany({
      where:   { is_active: true },
      select: {
        id: true,
        name: true,
        price: true,
        pairing_bonus_value: true,
        products: {
          select: {
            quantity: true,
            product: { select: { price: true, reseller_price: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      packages: packages.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        pairing_bonus_value: Number(pkg.pairing_bonus_value || 0),
        price: pkg.products.length > 0
          ? calculatePackageEconomics(pkg.products).pinAllocation
          : Number(pkg.price),
      }))
        .filter((pkg) => !upgradeProfile || (
          pkg.id !== upgradeProfile.package_id &&
          pkg.pairing_bonus_value > Number(upgradeProfile.package.pairing_bonus_value || 0)
        ))
        .sort((a, b) => a.pairing_bonus_value - b.pairing_bonus_value),
    })
  } catch (error) {
    console.error('[CITY PACKAGES ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
