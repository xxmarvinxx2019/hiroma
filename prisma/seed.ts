import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const connectionString = `${process.env.DATABASE_URL}`
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Seeding Hiroma database...')

  // ── Create Admin User ──
  const hashedPassword = await bcrypt.hash('Hiroma2026!', 12)

  const admin = await prisma.user.upsert({
    where: { username: 'hiroadmin' },
    update: {},
    create: {
      username: 'hiroadmin',
      full_name: 'Hiroma Admin',
      email: 'admin@hiroma.com',
      mobile: '+639000000000',
      password_hash: hashedPassword,
      role: 'admin',
      status: 'active',
    },
  })

  // ── Create Admin Wallet ──
  await prisma.wallet.upsert({
    where: { user_id: admin.id },
    update: {},
    create: {
      user_id: admin.id,
      balance: 0,
      total_earned: 0,
      total_withdrawn: 0,
    },
  })

  console.log('✅ Admin user created!')
  console.log('   Username: hiroadmin')
  console.log('   Password: Hiroma2026!')
  console.log('   Role:     admin')
  console.log('')
  console.log('🎉 Seeding complete!')
}

main()
  .then(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
  .catch(async (e) => {
    console.error('❌ Seed error:', e)
    await prisma.$disconnect()
    await pool.end()
    process.exit(1)
  })