import 'dotenv/config'
import { createHash } from 'node:crypto'
import { Pool } from 'pg'

type TargetRow = {
  database_name: string
  role_name: string
  reserve_table: string | null
}

type MigrationRow = {
  migration_name: string
  checksum: string
  finished_at: Date | null
  rolled_back_at: Date | null
}

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

async function inspectTarget(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
  })
  try {
    const target = await pool.query<TargetRow>(`
      SELECT
        current_database() database_name,
        current_user role_name,
        to_regclass('public.binary_reserve_lots')::text reserve_table
    `)
    return target.rows[0]
  } finally {
    await pool.end()
  }
}

async function migrationFingerprint(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
  })
  try {
    const migrations = await pool.query<MigrationRow>(`
      SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM public._prisma_migrations
      ORDER BY migration_name
    `)
    const canonical = migrations.rows.map((row) => ({
      migrationName: row.migration_name,
      checksum: row.checksum,
      applied: Boolean(row.finished_at && !row.rolled_back_at),
    }))
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  } finally {
    await pool.end()
  }
}

async function main() {
  const ownerUrl = required('PRODUCTION_DATABASE_URL')
  const runtimeUrl = required('FINANCIAL_RUNTIME_DATABASE_URL')
  const expectedDatabase = required('PRODUCTION_DATABASE_EXPECTED_NAME')

  if (ownerUrl === runtimeUrl) {
    throw new Error('Production owner and runtime database URLs must be different.')
  }

  const [owner, runtime, migrations] = await Promise.all([
    inspectTarget(ownerUrl),
    inspectTarget(runtimeUrl),
    migrationFingerprint(ownerUrl),
  ])

  if (!owner || !runtime) throw new Error('Unable to inspect both database targets.')
  if (owner.database_name !== expectedDatabase || runtime.database_name !== expectedDatabase) {
    throw new Error('A production database connection does not match the approved database name.')
  }
  if (owner.database_name !== runtime.database_name) {
    throw new Error('Production owner and runtime connections target different databases.')
  }
  if (owner.role_name === runtime.role_name) {
    throw new Error('Production owner and runtime connections resolve to the same database role.')
  }
  if (!owner.reserve_table || !runtime.reserve_table) {
    throw new Error('The protected binary reserve schema is missing from a production connection.')
  }

  const targetFingerprint = createHash('sha256')
    .update(`${owner.database_name}:${migrations}`)
    .digest('hex')

  console.log(JSON.stringify({
    targetFingerprint,
    expectedDatabaseMatched: true,
    rolesAreDistinct: true,
    protectedReserveSchemaPresent: true,
    migrationFingerprint: migrations,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

