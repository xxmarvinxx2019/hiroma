import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'

// ============================================================
// Vercel Serverless-compatible Prisma Client
// Uses a single connection pool with proper serverless settings
// ============================================================

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  // Use Supabase's transaction pooler URL (port 6543) for serverless
  // This avoids connection limit issues on Vercel
  const connectionString = process.env.DATABASE_URL!

  const pool = new Pool({
    connectionString,
    // Serverless-optimized settings
    max: 1,                        // Only 1 connection per function instance
    idleTimeoutMillis: 10000,      // Release idle connections quickly
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,         // Allow process to exit when idle
  })

  const adapter = new PrismaPg(pool)

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

// Only cache in development — in production each invocation is fresh
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma