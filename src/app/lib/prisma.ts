import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

declare global {
  var prisma: PrismaClient | undefined
}

function getClient() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  const pool = new Pool({
    connectionString,
    max:                     2,
    idleTimeoutMillis:       10000,
    connectionTimeoutMillis: 10000,
  })

  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

export const prisma = global.prisma || getClient()

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}

export default prisma