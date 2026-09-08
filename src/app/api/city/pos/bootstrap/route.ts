import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function locationCode(value: string | null | undefined): string {
  return (value || 'MAIN')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X')
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })

    const body = await req.json()
    const installationId = cleanText(body.installation_id, 120)
    const terminalName = cleanText(body.name, 120)
    const platform = cleanText(body.platform, 80) || null
    if (!installationId || !terminalName) {
      return NextResponse.json({ error: 'Terminal installation ID and name are required.' }, { status: 400 })
    }

    const existing = await prisma.posTerminal.findUnique({
      where: { installation_id: installationId },
    })
    if (existing && existing.owner_id !== user.id) {
      return NextResponse.json(
        {
          error: 'This POS installation is already assigned to another location.',
        },
        { status: 409 },
      )
    }
    if (existing && !existing.is_active) {
      return NextResponse.json(
        {
          error: 'This POS terminal has been disabled. Ask the branch owner to reactivate it before continuing.',
        },
        { status: 403 },
      )
    }

    if (!existing) {
      return NextResponse.json(
        {
          error: 'This device is not enrolled as an authorized POS terminal.',
          code: 'POS_ENROLLMENT_REQUIRED',
          setup_url: '/dashboard/city/pos/setup',
        },
        { status: 403 },
      )
    }

    const actorId = user.actor_id || user.id
    const terminal = await prisma.posTerminal.update({
          where: { id: existing.id },
          data: { platform },
        })

    const [owner, inventory, paymentMethods, openShift, blockingShift, registrationPackages] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          full_name: true,
          address: true,
          street_address: true,
          region_name: true,
          province_name: true,
          city_muni_name: true,
          barangay_name: true,
          zip_code: true,
          distributor_profile: {
            select: {
              dist_level: true,
            coverage_area: true,
            fulfillment_outlet_name: true,
            fulfillment_outlet_address: true,
            fulfillment_outlet_barangay_name: true,
            fulfillment_outlet_city_muni_name: true,
            fulfillment_outlet_province_name: true,
            fulfillment_outlet_region_name: true,
            fulfillment_outlet_zip_code: true,
            },
          },
        },
      }),
      prisma.inventory.findMany({
        where: { owner_id: user.id, product: { is_active: true } },
        select: {
          product_id: true,
          quantity: true,
          reserved_quantity: true,
          updated_at: true,
          product: {
            select: {
              name: true,
              barcode: true,
              type: true,
              reseller_price: true,
              price: true,
              pu_value: true,
            },
          },
        },
        orderBy: { product: { name: 'asc' } },
      }),
      prisma.paymentMethod.findMany({
        where: { user_id: user.id, status: 'approved' },
        select: {
          id: true,
          type: true,
          account_name: true,
          account_number: true,
          bank_name: true,
        },
      }),
      prisma.posShift.findFirst({
        where: {
          terminal_id: terminal.id,
          opened_by_id: actorId,
          status: 'open',
        },
        select: { id: true, opened_at: true, opening_cash: true },
      }),
      prisma.posShift.findFirst({
        where: {
          terminal_id: terminal.id,
          opened_by_id: actorId,
          status: { in: ['locally_closed', 'needs_review'] },
        },
        orderBy: { opened_at: 'desc' },
        select: {
          id: true,
          status: true,
          opened_at: true,
          closing_submitted_at: true,
          closing_explanation: true,
        },
      }),
      prisma.package.findMany({
        where: { is_active: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          products: {
            select: {
              product_id: true,
              quantity: true,
              product: { select: { name: true, price: true } },
            },
          },
        },
      }),
    ])

    if (blockingShift?.status === 'needs_review') {
      const existingRecountNotification = await prisma.notification.findFirst({
        where: {
          user_id: actorId,
          type: 'pos_shift_recount_required',
          entity_type: 'pos_shift',
          entity_id: blockingShift.id,
        },
        select: { id: true },
      })
      if (!existingRecountNotification) {
        await prisma.notification.upsert({
          where: { id: `pos-shift-recount:${blockingShift.id}` },
          update: {},
          create: {
            id: `pos-shift-recount:${blockingShift.id}`,
            user_id: actorId,
            type: 'pos_shift_recount_required',
            title: 'Shift returned for recount',
            message: `Your manager returned this shift for recount. Note: ${blockingShift.closing_explanation || 'Please recount the drawer and inventory, then resubmit this shift.'}`,
            entity_type: 'pos_shift',
            entity_id: blockingShift.id,
            action_url: '/dashboard/city/pos/history',
          },
        })
      }
    }

    await prisma.posTerminal.update({
      where: { id: terminal.id },
      data: { last_catalog_at: new Date(), last_inventory_at: new Date() },
    })

    const suppliedRange = body.receipt_range
    const validRange = suppliedRange && suppliedRange.terminal_id === terminal.id && Number.isInteger(suppliedRange.start) && Number.isInteger(suppliedRange.end) && Number.isInteger(suppliedRange.next) && suppliedRange.start > 0 && suppliedRange.start <= suppliedRange.next && suppliedRange.next <= suppliedRange.end && suppliedRange.end < terminal.receipt_sequence_next
    let receiptRange = validRange ? suppliedRange : null
    if (!receiptRange) {
      const reserved = await prisma.posTerminal.update({
        where: { id: terminal.id },
        data: { receipt_sequence_next: { increment: 100 } },
        select: { receipt_sequence_next: true },
      })
      receiptRange = {
        terminal_id: terminal.id,
        start: reserved.receipt_sequence_next - 100,
        end: reserved.receipt_sequence_next - 1,
        next: reserved.receipt_sequence_next - 100,
      }
    }

    const physicalOutletAddress = [
      owner?.distributor_profile?.fulfillment_outlet_address,
      owner?.distributor_profile?.fulfillment_outlet_barangay_name,
      owner?.distributor_profile?.fulfillment_outlet_city_muni_name,
      owner?.distributor_profile?.fulfillment_outlet_province_name,
      owner?.distributor_profile?.fulfillment_outlet_region_name,
      owner?.distributor_profile?.fulfillment_outlet_zip_code,
    ].filter((part, index, values): part is string => Boolean(part?.trim()) && values.indexOf(part) === index).join(", ");
    const registeredAddress = [
      owner?.street_address,
      owner?.barangay_name,
      owner?.city_muni_name,
      owner?.province_name,
      owner?.region_name,
      owner?.zip_code,
    ].filter((part, index, values): part is string => Boolean(part?.trim()) && values.indexOf(part) === index).join(", ");
    const hasPhysicalOutlet = Boolean(owner?.distributor_profile?.fulfillment_outlet_address?.trim());
    const receiptAddress = (hasPhysicalOutlet ? physicalOutletAddress : registeredAddress)
      || owner?.address
      || owner?.distributor_profile?.coverage_area
      || "";

    return NextResponse.json({
      cashier: {
        id: actorId,
        full_name: user.actor_name || user.full_name,
        username: user.actor_username || user.username,
        staff_type: user.staff_type || (user.is_staff ? 'staff' : 'location_owner'),
      },
      terminal: {
        id: terminal.id,
        name: terminal.name,
        installation_id: terminal.installation_id,
        receipt_code: terminal.receipt_code,
      },
      receipt_location_code: locationCode(owner?.distributor_profile?.coverage_area || owner?.full_name),
      receipt_range: receiptRange,
      receipt_outlet_name: owner?.distributor_profile?.fulfillment_outlet_name?.trim() || owner?.full_name || "HIROMA POINT OF SALE",
      receipt_address: receiptAddress,
      receipt_address_source: hasPhysicalOutlet ? "physical_outlet" : "registered_address",
      location: owner,
      open_shift: openShift,
      blocking_shift: blockingShift,
      catalog: inventory.map((row) => ({
        product_id: row.product_id,
        barcode: row.product.barcode,
        name: row.product.name,
        type: row.product.type,
        stock: Math.max(0, row.quantity - row.reserved_quantity),
        stock_updated_at: row.updated_at,
        reseller_price: Number(row.product.reseller_price),
        srp_price: Number(row.product.price),
        pu_value: row.product.pu_value,
      })),
      payment_methods: [{ id: 'cash', type: 'cash', account_name: 'Cash' }, ...paymentMethods],
      registration_packages: registrationPackages.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        total: pkg.products.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0),
        products: pkg.products.map((item) => ({
          product_id: item.product_id,
          name: item.product.name,
          quantity: item.quantity,
        })),
      })),
      offline_policy: {
        requires_active_shift: true,
        payment_methods: ['cash'],
        registration_requires_online_review: true,
        server_finalization_requires_sync: true,
        inventory_mode: 'terminal_allowance',
      },
    })
  } catch (error) {
    console.error('[POS BOOTSTRAP]', error)
    return NextResponse.json({ error: 'Unable to initialize this POS terminal.' }, { status: 500 })
  }
}
