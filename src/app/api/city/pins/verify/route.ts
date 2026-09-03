import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import {
  readIssuedRegistrationPinSnapshot,
  RegistrationPinSnapshotError,
} from '@/app/lib/registrationPinSnapshot'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pin_code } = await req.json()

    if (!pin_code) {
      return NextResponse.json({ error: 'PIN code is required.' }, { status: 400 })
    }

    const pin = await prisma.pin.findUnique({
      where: { pin_code: pin_code.trim().toUpperCase() },
      select: {
        id:           true,
        pin_code:     true,
        status:       true,
        pin_type:     true,
        package_id:   true,
        city_dist_id: true,
        pin_allocation_snapshot: true,
        registration_package_name_snapshot: true,
        registration_customer_payment_snapshot: true,
        registration_reseller_value_snapshot: true,
        registration_acquisition_cost_snapshot: true,
        registration_acquisition_tier_snapshot: true,
        registration_direct_allocation_snapshot: true,
        registration_binary_allocation_snapshot: true,
        registration_points_snapshot: true,
        registration_product_line_count_snapshot: true,
        registration_units_snapshot: true,
        registration_product_snapshots: {
          select: {
            product_id: true,
            quantity: true,
            srp_snapshot: true,
            reseller_price_snapshot: true,
            unit_acquisition_cost_snapshot: true,
            product: { select: { id: true, name: true } },
          },
        },
      },
    })

    if (!pin) {
      return NextResponse.json({ error: 'PIN not found. Please check and try again.' }, { status: 404 })
    }

    if (pin.status !== 'unused') {
      return NextResponse.json({ error: `This PIN has already been ${pin.status}.` }, { status: 400 })
    }

    if (pin.pin_type !== 'registration') {
      return NextResponse.json({ error: 'This is an Upgrade PIN. Use it only from the reseller’s Upgrade Package action.' }, { status: 400 })
    }

    if (pin.city_dist_id !== user.id) {
      return NextResponse.json({ error: 'This PIN does not belong to your account.' }, { status: 400 })
    }

    const snapshot = readIssuedRegistrationPinSnapshot(pin)

    // Inventory and displayed economics must use the same frozen product rows
    // that will be consumed by registration.
    const packageProductIds = snapshot.products.map((product) => product.product_id)

    const inventoryItems = await prisma.inventory.findMany({
      where:  { owner_id: user.id, product_id: { in: packageProductIds } },
      select: { product_id: true, quantity: true },
    })

    const inventoryMap = new Map(inventoryItems.map((i) => [i.product_id, i.quantity]))

    const productName = new Map(pin.registration_product_snapshots.map((item) => [item.product_id, item.product.name]))
    const stockErrors = snapshot.products
      .filter((product) => (inventoryMap.get(product.product_id) ?? 0) < product.quantity)
      .map((product) => `"${productName.get(product.product_id) || 'Product'}": need ${product.quantity}, only ${inventoryMap.get(product.product_id) ?? 0} in stock`)

    if (stockErrors.length > 0) {
      return NextResponse.json({
        error: `Insufficient inventory for package "${snapshot.packageName}":\n${stockErrors.join('\n')}`,
      }, { status: 400 })
    }

    return NextResponse.json({
      pin: {
        id: pin.id,
        pin_code: pin.pin_code,
        status: pin.status,
        pin_type: pin.pin_type,
        package: {
          id: snapshot.packageId,
          name: snapshot.packageName,
          price: snapshot.pinAllocation,
          products: pin.registration_product_snapshots.map((item) => ({
            quantity: item.quantity,
            product: {
              id: item.product.id,
              name: item.product.name,
              price: Number(item.srp_snapshot),
              reseller_price: Number(item.reseller_price_snapshot),
            },
          })),
        },
      },
    })
  } catch (error) {
    console.error('[VERIFY PIN ERROR]', error)
    return NextResponse.json(
      { error: error instanceof RegistrationPinSnapshotError ? error.message : 'Something went wrong.' },
      { status: error instanceof RegistrationPinSnapshotError ? 409 : 500 },
    )
  }
}
