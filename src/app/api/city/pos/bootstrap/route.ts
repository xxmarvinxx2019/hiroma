import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
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

    const existing = await prisma.posTerminal.findUnique({ where: { installation_id: installationId } })
    if (existing && existing.owner_id !== user.id) {
      return NextResponse.json({ error: 'This POS installation is already assigned to another location.' }, { status: 409 })
    }

    const actorId = user.actor_id || user.id
    const terminal = existing
      ? await prisma.posTerminal.update({ where: { id: existing.id }, data: { platform, is_active: true } })
      : await prisma.posTerminal.create({ data: { owner_id: user.id, installation_id: installationId, name: terminalName, platform } })

    const [owner, inventory, paymentMethods, openShift] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, full_name: true, distributor_profile: { select: { dist_level: true, coverage_area: true, fulfillment_outlet_name: true } } },
      }),
      prisma.inventory.findMany({
        where: { owner_id: user.id, product: { is_active: true } },
        select: {
          product_id: true, quantity: true, reserved_quantity: true, updated_at: true,
          product: { select: { name: true, type: true, reseller_price: true, price: true, city_price: true, branch_price: true, cost_price: true, pu_value: true } },
        },
        orderBy: { product: { name: 'asc' } },
      }),
      prisma.paymentMethod.findMany({ where: { user_id: user.id, status: 'approved' }, select: { id: true, type: true, account_name: true, bank_name: true } }),
      prisma.posShift.findFirst({ where: { terminal_id: terminal.id, opened_by_id: actorId, status: 'open' }, select: { id: true, opened_at: true, opening_cash: true } }),
    ])

    await prisma.posTerminal.update({ where: { id: terminal.id }, data: { last_catalog_at: new Date(), last_inventory_at: new Date() } })

    return NextResponse.json({
      terminal: { id: terminal.id, name: terminal.name, installation_id: terminal.installation_id },
      location: owner,
      open_shift: openShift,
      catalog: inventory.map((row) => ({
        product_id: row.product_id,
        name: row.product.name,
        type: row.product.type,
        stock: Math.max(0, row.quantity - row.reserved_quantity),
        stock_updated_at: row.updated_at,
        reseller_price: Number(row.product.reseller_price),
        srp_price: Number(row.product.price),
        acquisition_cost: Number(owner?.distributor_profile?.dist_level === 'branch' ? row.product.branch_price : row.product.city_price || row.product.cost_price),
        pu_value: row.product.pu_value,
      })),
      payment_methods: [{ id: 'cash', type: 'cash', account_name: 'Cash' }, ...paymentMethods],
      offline_policy: {
        requires_active_shift: true,
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
