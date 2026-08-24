import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

type LedgerRow = {
  id: string
  occurred_at: Date
  event_type: string
  direction: 'in' | 'out' | 'neutral'
  product_id: string | null
  product_name: string
  quantity: number
  unit_cost: number
  total_value: number
  reference: string
  actor: string
  reason: string
  balance_before: number | null
  balance_after: number | null
  source: 'recorded' | 'historical'
  source_note: string
}

// Transactions before this immutable-event integration may be reconstructed.
// Transactions on/after the cutover must come from inventory_audit_events only.
const RECORDED_EVENT_CUTOVER = new Date('2026-08-21T14:45:00+08:00')

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const params = req.nextUrl.searchParams
    const page = Math.max(1, Number(params.get('page') || 1))
    const pageSize = Math.min(100, Math.max(10, Number(params.get('pageSize') || 25)))
    const type = params.get('type') || 'all'
    const search = (params.get('search') || '').trim().toLowerCase()
    const from = params.get('from') ? new Date(`${params.get('from')}T00:00:00+08:00`) : null
    const to = params.get('to') ? new Date(`${params.get('to')}T23:59:59.999+08:00`) : null
    const dateWhere = { ...(from && { gte: from }), ...(to && { lte: to }) }

    const [events, transfers, orders, registrations, upgrades, products] = await Promise.all([
      prisma.inventoryAuditEvent.findMany({
        where: { owner_id: user.id, ...(from || to ? { created_at: dateWhere } : {}) },
        orderBy: { created_at: 'desc' },
        take: 1000,
      }),
      prisma.inventoryMovement.findMany({
        where: { recipient_id: user.id, received_at: { not: null }, ...(from || to ? { received_at: dateWhere } : {}) },
        orderBy: { received_at: 'desc' },
        take: 1000,
      }),
      prisma.order.findMany({
        where: { seller_id: user.id, status: 'delivered', delivered_at: { ...dateWhere, lt: RECORDED_EVENT_CUTOVER } },
        select: { id: true, order_number: true, delivered_at: true, created_at: true, customer_name: true, is_non_member_sale: true, buyer: { select: { full_name: true, username: true } }, items: { select: { id: true, product_id: true, quantity: true, unit_acquisition_cost: true, product: { select: { name: true, city_price: true, branch_price: true, cost_price: true } } } } },
        orderBy: { delivered_at: 'desc' },
        take: 1000,
      }),
      prisma.registrationFinancial.findMany({
        where: { city_dist_id: user.id, created_at: { ...dateWhere, lt: RECORDED_EVENT_CUTOVER } },
        orderBy: { created_at: 'desc' }, take: 1000,
      }),
      prisma.upgradeFinancial.findMany({
        where: { city_dist_id: user.id, created_at: { ...dateWhere, lt: RECORDED_EVENT_CUTOVER } },
        orderBy: { created_at: 'desc' }, take: 1000,
      }),
      prisma.product.findMany({ select: { id: true, name: true, city_price: true, branch_price: true, cost_price: true } }),
    ])
    const profile = await prisma.distributorProfile.findUnique({ where: { user_id: user.id }, select: { dist_level: true } })
    const isBranch = profile?.dist_level === 'branch'
    const productMap = new Map(products.map((product) => [product.id, product]))
    const packageIds = [...new Set([...registrations.map((r) => r.package_id), ...upgrades.flatMap((u) => [u.from_package_id, u.to_package_id])])]
    const pinIds = [...new Set([...registrations.map((r) => r.pin_id), ...upgrades.map((u) => u.upgrade_pin_id)])]
    const packageProducts = packageIds.length ? await prisma.packageProduct.findMany({ where: { package_id: { in: packageIds } } }) : []
    const pins: Array<{ id: string; pin_code: string }> = pinIds.length
      ? await prisma.pin.findMany({ where: { id: { in: pinIds } }, select: { id: true, pin_code: true } })
      : []
    const pinCodeById = new Map(pins.map((pin) => [pin.id, pin.pin_code]))
    const byPackage = new Map<string, Map<string, number>>()
    for (const row of packageProducts) {
      const map = byPackage.get(row.package_id) || new Map<string, number>()
      map.set(row.product_id, row.quantity)
      byPackage.set(row.package_id, map)
    }
    const unitCost = (productId: string) => {
      const product = productMap.get(productId)
      if (!product) return 0
      return (isBranch ? Number(product.branch_price) : Number(product.city_price)) || Number(product.cost_price)
    }

    const rows: LedgerRow[] = []
    const recordedOrderIds = new Set(events.filter((event) => event.reference_type === 'order' && event.reference_id).map((event) => event.reference_id!))
    const recordedRegistrationPinIds = new Set(events.filter((event) => event.reference_type === 'registration_pin' && event.reference_id).map((event) => event.reference_id!))
    const recordedUpgradePinIds = new Set(events.filter((event) => event.reference_type === 'upgrade_pin' && event.reference_id).map((event) => event.reference_id!))
    for (const event of events) {
      const product = event.product_id ? productMap.get(event.product_id) : null
      const delta = event.quantity_delta
      const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata) ? event.metadata as Record<string, unknown> : {}
      const displayReference = typeof metadata.order_number === 'string' && metadata.order_number
        ? metadata.order_number
        : typeof metadata.pin_code === 'string' && metadata.pin_code
          ? metadata.pin_code
          : event.reference_id || '—'
      rows.push({
        id: `event-${event.id}`, occurred_at: event.created_at, event_type: event.event_type,
        direction: delta > 0 ? 'in' : delta < 0 ? 'out' : 'neutral', product_id: event.product_id,
        product_name: product?.name || 'Inventory audit', quantity: Math.abs(delta), unit_cost: Number(event.unit_cost_snapshot || 0),
        total_value: Number(event.total_value || 0), reference: displayReference, actor: event.actor_name_snapshot,
        reason: event.reason || '—', balance_before: event.quantity_before, balance_after: event.quantity_after, source: 'recorded',
        source_note: 'Immutable inventory event captured when the transaction occurred.',
      })
    }
    for (const movement of transfers) {
      const qty = movement.accepted_quantity ?? 0
      const product = productMap.get(movement.product_id)
      rows.push({
        id: `transfer-${movement.id}`, occurred_at: movement.received_at!, event_type: 'transfer_received', direction: 'in',
        product_id: movement.product_id, product_name: product?.name || 'Unknown product', quantity: qty,
        unit_cost: Number(movement.unit_price), total_value: qty * Number(movement.unit_price), reference: movement.transfer_id || movement.id,
        actor: 'Receiving staff', reason: movement.receiving_notes || movement.notes || 'Stock transfer received',
        balance_before: movement.recipient_stock_before, balance_after: movement.recipient_stock_after, source: 'recorded',
        source_note: 'Recorded receiving event with before-and-after stock balances.',
      })
    }
    for (const order of orders) for (const item of recordedOrderIds.has(order.id) ? [] : order.items) {
      const cost = Number(item.unit_acquisition_cost ?? (isBranch ? item.product.branch_price : item.product.city_price) ?? item.product.cost_price)
      const saleChannel = order.is_non_member_sale ? 'Non-member / SRP sale' : 'Reseller repeat order'
      const customer = order.customer_name || order.buyer.full_name || `@${order.buyer.username}`
      rows.push({
        id: `order-${item.id}`, occurred_at: order.delivered_at || order.created_at, event_type: order.is_non_member_sale ? 'non_member_srp_sale' : 'reseller_repeat_order', direction: 'out',
        product_id: item.product_id, product_name: item.product.name, quantity: item.quantity, unit_cost: cost, total_value: item.quantity * cost,
        reference: order.order_number || order.id, actor: saleChannel, reason: `${saleChannel} delivered to ${customer}`,
        balance_before: null, balance_after: null, source: 'historical',
        source_note: 'Reconstructed from a completed legacy order because no immutable inventory event was stored at delivery time.',
      })
    }
    for (const registration of registrations) {
      if (recordedRegistrationPinIds.has(registration.pin_id)) continue
      for (const [productId, qty] of byPackage.get(registration.package_id) || []) {
        const cost = unitCost(productId)
        rows.push({
          id: `registration-${registration.id}-${productId}`, occurred_at: registration.created_at, event_type: 'registration_package_release', direction: 'out',
          product_id: productId, product_name: productMap.get(productId)?.name || 'Unknown product', quantity: qty, unit_cost: cost, total_value: qty * cost,
          reference: pinCodeById.get(registration.pin_id) || registration.pin_id, actor: 'New reseller registration', reason: `${registration.package_name_snapshot} package products released using registration PIN`,
          balance_before: null, balance_after: null, source: registration.allocation_snapshot_source === 'registration' ? 'recorded' : 'historical',
          source_note: registration.allocation_snapshot_source === 'registration'
            ? 'Recorded registration financial snapshot; reference is the registration PIN.'
            : 'Reconstructed from a legacy registration using the best available package snapshot.',
        })
      }
    }
    for (const upgrade of upgrades) {
      if (recordedUpgradePinIds.has(upgrade.upgrade_pin_id)) continue
      const fromProducts = byPackage.get(upgrade.from_package_id) || new Map<string, number>()
      for (const [productId, toQty] of byPackage.get(upgrade.to_package_id) || []) {
        const qty = Math.max(0, toQty - (fromProducts.get(productId) || 0))
        if (!qty) continue
        const cost = unitCost(productId)
        rows.push({
          id: `upgrade-${upgrade.id}-${productId}`, occurred_at: upgrade.created_at, event_type: 'upgrade_package_release', direction: 'out',
          product_id: productId, product_name: productMap.get(productId)?.name || 'Unknown product', quantity: qty, unit_cost: cost, total_value: qty * cost,
          reference: pinCodeById.get(upgrade.upgrade_pin_id) || upgrade.upgrade_pin_id, actor: 'Package upgrade', reason: `${upgrade.from_package_name_snapshot} → ${upgrade.to_package_name_snapshot} incremental product release`,
          balance_before: null, balance_after: null, source: 'recorded',
          source_note: 'Recorded upgrade financial snapshot; reference is the Upgrade PIN.',
        })
      }
    }

    const filtered = rows.filter((row) => {
      const typeMatches = type === 'all' || row.event_type === type || (type === 'in' && row.direction === 'in') || (type === 'out' && row.direction === 'out') || (type === 'audit' && row.event_type.startsWith('physical_'))
      const searchMatches = !search || `${row.product_name} ${row.reference} ${row.actor} ${row.reason} ${row.event_type}`.toLowerCase().includes(search)
      return typeMatches && searchMatches
    }).sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime())

    const start = (page - 1) * pageSize
    const latestApproved = await prisma.inventoryAuditSession.findFirst({ where: { owner_id: user.id, status: 'approved' }, orderBy: { approved_at: 'desc' }, select: { reference_number: true, approved_at: true } })
    const submitted = await prisma.inventoryAuditSession.count({ where: { owner_id: user.id, status: 'submitted' } })
    return NextResponse.json({
      rows: filtered.slice(start, start + pageSize),
      meta: { total: filtered.length, page, pageSize, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) },
      summary: {
        stock_in_units: filtered.filter((row) => row.direction === 'in').reduce((sum, row) => sum + row.quantity, 0),
        stock_out_units: filtered.filter((row) => row.direction === 'out').reduce((sum, row) => sum + row.quantity, 0),
        adjustment_units: filtered.filter((row) => row.event_type === 'physical_count_adjustment').reduce((sum, row) => sum + Math.abs(row.quantity), 0),
        net_movement_units: filtered.reduce((sum, row) => sum + (row.direction === 'in' ? row.quantity : row.direction === 'out' ? -row.quantity : 0), 0),
        total_movement_value: filtered.reduce((sum, row) => sum + Math.abs(row.total_value), 0),
        movement_count: filtered.length,
        pending_approval: submitted,
        latest_approved_audit: latestApproved,
      },
    })
  } catch (error) {
    console.error('[INVENTORY AUDIT LEDGER]', error)
    return NextResponse.json({ error: 'Unable to load the inventory movement ledger.' }, { status: 500 })
  }
}
