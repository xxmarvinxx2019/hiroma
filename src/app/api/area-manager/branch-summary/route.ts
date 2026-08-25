import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const OFFSET = 8 * 60 * 60 * 1000
function boundary(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - OFFSET) }
function periodRange(value: string) {
  const now = new Date(Date.now() + OFFSET), today = boundary(now)
  if (value === 'all_time') return undefined
  if (value === 'yesterday') return { gte: new Date(today.getTime() - 86400000), lt: today }
  if (value === 'this_week') { const start = new Date(today.getTime() - ((now.getUTCDay() + 6) % 7) * 86400000); return { gte: start, lt: new Date(start.getTime() + 7 * 86400000) } }
  if (value === 'this_month') { const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - OFFSET); return { gte: start, lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - OFFSET) } }
  return { gte: today, lt: new Date(today.getTime() + 86400000) }
}

export async function GET(req: NextRequest) {
  try {
    const manager = await getCurrentUser()
    if (!manager || manager.role !== 'admin' || !manager.is_staff || manager.staff_type !== 'area_manager') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const ownerId = req.nextUrl.searchParams.get('branch_id') || ''
    if (!(manager.permissions || []).includes(`area_branch:${ownerId}`)) return NextResponse.json({ error: 'This branch is not assigned to your account.' }, { status: 403 })
    const range = periodRange(req.nextUrl.searchParams.get('period') || 'today')
    const branch = await prisma.user.findFirst({ where: { id: ownerId, role: 'city', status: 'active', distributor_profile: { is: { dist_level: 'branch', is_active: true } } }, select: { id: true } })
    if (!branch) return NextResponse.json({ error: 'Branch not found.' }, { status: 404 })

    const [inventory, orders, registrations, movements] = await Promise.all([
      prisma.inventory.findMany({ where: { owner_id: ownerId }, select: { quantity: true, reserved_quantity: true, product: { select: { name: true, branch_price: true, cost_price: true, reseller_price: true, price: true } } }, orderBy: { product: { name: 'asc' } } }),
      prisma.order.findMany({ where: { seller_id: ownerId, status: 'delivered', ...(range ? { OR: [{ delivered_at: range }, { delivered_at: null, created_at: range }] } : {}) }, select: { id: true, total_amount: true, payment_status: true, is_non_member_sale: true, items: { select: { quantity: true, subtotal: true, unit_acquisition_cost: true, product: { select: { name: true, branch_price: true, cost_price: true } } } } } }),
      prisma.registrationFinancial.findMany({ where: { city_dist_id: ownerId, ...(range ? { created_at: range } : {}) }, select: { pin_id: true, created_at: true, customer_payment: true, reseller_value: true, product_acquisition_cost: true, pin_allocation: true, registration_profit: true, payment_status: true, package_name_snapshot: true, package_units_snapshot: true }, orderBy: { created_at: 'desc' } }),
      prisma.inventoryMovement.findMany({ where: { recipient_id: ownerId, ...(range ? { created_at: range } : {}) }, select: { quantity: true, accepted_quantity: true, damaged_quantity: true, missing_quantity: true, is_sale: true } }),
    ])

    let productSales = 0, productCost = 0, productUnits = 0, productCollections = 0
    const products = new Map<string, { name: string; units: number; sales: number; cost: number }>()
    for (const order of orders) {
      if (order.payment_status === 'paid') productCollections += Number(order.total_amount)
      for (const item of order.items) {
        const sales = Number(item.subtotal), unitCost = item.unit_acquisition_cost == null ? Number(item.product.branch_price || item.product.cost_price) : Number(item.unit_acquisition_cost), cost = unitCost * item.quantity
        productSales += sales; productCost += cost; productUnits += item.quantity
        const row = products.get(item.product.name) || { name: item.product.name, units: 0, sales: 0, cost: 0 }
        row.units += item.quantity; row.sales += sales; row.cost += cost; products.set(item.product.name, row)
      }
    }
    const registration = registrations.reduce((sum, row) => ({ count: sum.count + 1, units: sum.units + (row.package_units_snapshot || 0), customer_payment: sum.customer_payment + Number(row.customer_payment), recognized_sales: sum.recognized_sales + Number(row.reseller_value), cost: sum.cost + Number(row.product_acquisition_cost), pin_allocation: sum.pin_allocation + Number(row.pin_allocation), profit: sum.profit + Number(row.reseller_value) - Number(row.product_acquisition_cost), collected: sum.collected + (row.payment_status === 'paid' ? Number(row.customer_payment) : 0) }), { count: 0, units: 0, customer_payment: 0, recognized_sales: 0, cost: 0, pin_allocation: 0, profit: 0, collected: 0 })
    const pins = registrations.length ? await prisma.pin.findMany({ where: { id: { in: registrations.map(({ pin_id }) => pin_id) } }, select: { id: true, pin_code: true } }) : []
    const pinCodes = new Map(pins.map((pin) => [pin.id, pin.pin_code]))
    const stock = inventory.map((row) => { const unitCost = Number(row.product.branch_price || row.product.cost_price), unitSale = Number(row.product.reseller_price || row.product.price); return { name: row.product.name, quantity: row.quantity, reserved: row.reserved_quantity, unit_cost: unitCost, cost_value: unitCost * row.quantity, potential_sales: unitSale * row.quantity } })
    const movement = movements.reduce((sum, row) => ({ received: sum.received + Math.max(0, row.accepted_quantity ?? row.quantity), damaged: sum.damaged + (row.damaged_quantity || 0), missing: sum.missing + (row.missing_quantity || 0) }), { received: 0, damaged: 0, missing: 0 })
    return NextResponse.json({
      summary: { gross_sales: productSales + registration.recognized_sales, product_sales: productSales, registration_sales: registration.recognized_sales, total_cost: productCost + registration.cost, gross_profit: productSales + registration.recognized_sales - productCost - registration.cost, collected_cash: productCollections + registration.collected, outstanding_cash: productSales + registration.customer_payment - productCollections - registration.collected, orders: orders.length, units_sold: productUnits, registrations: registration.count, registration_customer_payment: registration.customer_payment, pin_allocation: registration.pin_allocation },
      stock: { products: stock.length, units: stock.reduce((s, row) => s + row.quantity, 0), cost_value: stock.reduce((s, row) => s + row.cost_value, 0), potential_sales: stock.reduce((s, row) => s + row.potential_sales, 0), rows: stock },
      movement, products: [...products.values()].sort((a, b) => b.sales - a.sales),
      registration_ledger: registrations.slice(0, 100).map((row) => ({ pin_code: pinCodes.get(row.pin_id) || row.pin_id, date: row.created_at, package: row.package_name_snapshot, units: row.package_units_snapshot || 0, customer_payment: Number(row.customer_payment), recognized_sales: Number(row.reseller_value), cost: Number(row.product_acquisition_cost), pin_allocation: Number(row.pin_allocation), profit: Number(row.reseller_value) - Number(row.product_acquisition_cost), payment_status: row.payment_status })),
      deposit: { supported: false, message: 'No bank-deposit ledger is recorded yet. Collected cash cannot be confirmed as deposited without a deposit amount, reference, date, and proof.' },
      basis: 'Delivered orders and immutable registration financial snapshots for the selected period.',
    })
  } catch (error) {
    console.error('[AREA MANAGER BRANCH SUMMARY]', error)
    return NextResponse.json({ error: 'Unable to load the branch transaction audit summary.' }, { status: 500 })
  }
}
