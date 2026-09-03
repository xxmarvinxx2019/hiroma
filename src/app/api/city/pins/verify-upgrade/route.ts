import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pin_code, reseller_id, target_package_id } = await req.json()
    if (!pin_code || !reseller_id || !target_package_id) {
      return NextResponse.json({ error: 'PIN code, reseller, and target package are required.' }, { status: 400 })
    }

    const reseller = await prisma.resellerProfile.findUnique({
      where: { user_id: reseller_id },
      select: {
        package_id: true,
        city_dist_id: true,
        package: {
          select: {
            name: true,
            pairing_bonus_value: true,
            products: { select: { product_id: true, quantity: true } },
          },
        },
      },
    })
    if (!reseller || reseller.city_dist_id !== user.id) {
      return NextResponse.json({ error: 'Reseller not found under your account.' }, { status: 404 })
    }

    const pin = await prisma.pin.findUnique({
      where: { pin_code: String(pin_code).trim().toUpperCase() },
      select: {
        id: true,
        pin_code: true,
        status: true,
        city_dist_id: true,
        package_id: true,
        pin_type: true,
        upgrade_from_package_id: true,
        pin_allocation_snapshot: true,
        upgrade_customer_payment_snapshot: true,
        upgrade_reseller_value_snapshot: true,
        upgrade_acquisition_cost_snapshot: true,
        upgrade_acquisition_tier_snapshot: true,
        upgrade_direct_allocation_snapshot: true,
        upgrade_binary_allocation_snapshot: true,
        upgrade_points_difference_snapshot: true,
        upgrade_product_snapshots: {
          select: { product_id: true, quantity: true, unit_acquisition_cost_snapshot: true },
        },
        package: {
          select: {
            id: true,
            name: true,
            pairing_bonus_value: true,
            products: { select: { product_id: true, quantity: true } },
          },
        },
      },
    })

    if (!pin) return NextResponse.json({ error: 'Upgrade PIN not found.' }, { status: 404 })
    if (pin.status !== 'unused') return NextResponse.json({ error: `This PIN has already been ${pin.status}.` }, { status: 400 })
    if (pin.city_dist_id !== user.id) return NextResponse.json({ error: 'This PIN does not belong to your account.' }, { status: 400 })
    if (pin.pin_type !== 'upgrade') return NextResponse.json({ error: 'A registration PIN cannot be used here. Enter a dedicated Upgrade PIN.' }, { status: 400 })
    if (pin.upgrade_from_package_id !== reseller.package_id) return NextResponse.json({ error: `This Upgrade PIN is not valid from the reseller's current ${reseller.package.name} package.` }, { status: 400 })
    if (pin.package_id !== target_package_id) return NextResponse.json({ error: `PIN mismatch: this PIN is for ${pin.package.name}, not the selected target package.` }, { status: 400 })
    if (
      pin.pin_allocation_snapshot == null ||
      pin.upgrade_customer_payment_snapshot == null ||
      pin.upgrade_reseller_value_snapshot == null ||
      pin.upgrade_acquisition_cost_snapshot == null ||
      (pin.upgrade_acquisition_tier_snapshot !== 'city' && pin.upgrade_acquisition_tier_snapshot !== 'branch') ||
      pin.upgrade_direct_allocation_snapshot == null ||
      pin.upgrade_binary_allocation_snapshot == null ||
      pin.upgrade_points_difference_snapshot == null ||
      !Number.isInteger(Number(pin.upgrade_points_difference_snapshot)) ||
      Number(pin.upgrade_points_difference_snapshot) <= 0
    ) {
      return NextResponse.json({ error: 'This Upgrade PIN has no complete financial snapshot.' }, { status: 400 })
    }

    const extraProducts = pin.upgrade_product_snapshots
    if (
      extraProducts.length === 0 ||
      extraProducts.some((item) => item.unit_acquisition_cost_snapshot == null)
    ) {
      return NextResponse.json({ error: 'This Upgrade PIN has no product-release snapshot. Cancel it and generate a new PIN.' }, { status: 400 })
    }
    const stock = extraProducts.length
      ? await prisma.inventory.findMany({
          where: { owner_id: user.id, product_id: { in: extraProducts.map((item) => item.product_id) } },
          select: { product_id: true, quantity: true },
        })
      : []
    const insufficient = extraProducts.find((item) => (stock.find((row) => row.product_id === item.product_id)?.quantity || 0) < item.quantity)
    if (insufficient) return NextResponse.json({ error: 'Insufficient City inventory for the additional upgrade products.' }, { status: 400 })

    return NextResponse.json({
      pin: {
        id: pin.id,
        pin_code: pin.pin_code,
        package: { id: pin.package.id, name: pin.package.name, price: Number(pin.upgrade_customer_payment_snapshot) },
      },
    })
  } catch (error) {
    console.error('[VERIFY UPGRADE PIN ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
