import 'dotenv/config'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'

dotenv.config({ path: '.env.local', override: true })

const databaseUrl = process.env.DATABASE_URL || ''
const host = new URL(databaseUrl).hostname
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('POS development seed is blocked unless DATABASE_URL points to localhost.')
}

async function main() {
const { default: prisma } = await import('../src/app/lib/prisma')

const passwordHash = await bcrypt.hash('HiromaPOS2026!', 12)
const city = await prisma.user.upsert({
  where: { username: 'posbranch' },
  update: { password_hash: passwordHash, status: 'active', login_disabled: false },
  create: {
    member_id: 'POS-DEV-0001',
    username: 'posbranch',
    full_name: 'Hiroma POS Development Branch',
    mobile: '09000000000',
    email: 'pos-dev@localhost.test',
    password_hash: passwordHash,
    role: 'city',
    status: 'active',
  },
})

await prisma.distributorProfile.upsert({
  where: { user_id: city.id },
  update: { is_active: true, fulfillment_outlet_name: 'Hiroma POS Test Branch', fulfillment_outlet_address: 'Local development only' },
  create: {
    user_id: city.id,
    dist_level: 'branch',
    coverage_area: 'Local POS Development',
    is_active: true,
    fulfillment_outlet_name: 'Hiroma POS Test Branch',
    fulfillment_outlet_address: 'Local development only',
  },
})

const cashierPasswordHash = await bcrypt.hash('HiromaCashier2026!', 12)
const cashier = await prisma.user.upsert({
  where: { username: 'poscashier' },
  update: { password_hash: cashierPasswordHash, status: 'active', login_disabled: false },
  create: {
    member_id: 'POS-STAFF-0001',
    username: 'poscashier',
    full_name: 'Hiroma POS Test Cashier',
    mobile: '09000000001',
    email: 'pos-cashier@localhost.test',
    password_hash: cashierPasswordHash,
    role: 'staff',
    status: 'active',
  },
})
await prisma.staffProfile.upsert({
  where: { user_id: cashier.id },
  update: { owner_id: city.id, permissions: ['pos'], is_active: true, staff_type: 'custom' },
  create: { user_id: cashier.id, owner_id: city.id, permissions: ['pos'], is_active: true, staff_type: 'custom' },
})

let product = await prisma.product.findFirst({ where: { name: 'Hiroma Poseidon 200ml' } })
product = product
  ? await prisma.product.update({ where: { id: product.id }, data: { is_active: true, price: 249, reseller_price: 183, branch_price: 163, city_price: 163, cost_price: 150, pu_value: 1 } })
  : await prisma.product.create({ data: { name: 'Hiroma Poseidon 200ml', description: 'Local POS test product', type: 'physical', price: 249, reseller_price: 183, branch_price: 163, city_price: 163, cost_price: 150, pu_value: 1, is_active: true } })

await prisma.inventory.upsert({
  where: { owner_id_product_id: { owner_id: city.id, product_id: product.id } },
  update: { quantity: 50, reserved_quantity: 0 },
  create: { owner_id: city.id, product_id: product.id, quantity: 50, reserved_quantity: 0, low_stock_threshold: 10 },
})

const payment = await prisma.paymentMethod.findFirst({ where: { user_id: city.id, type: 'gcash', account_number: '09000000000' } })
if (!payment) await prisma.paymentMethod.create({ data: { user_id: city.id, type: 'gcash', account_name: 'Hiroma POS Test', account_number: '09000000000', status: 'approved' } })

console.log('Local POS test account ready: posbranch / HiromaPOS2026!')
console.log('Restricted POS cashier ready: poscashier / HiromaCashier2026!')
await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
