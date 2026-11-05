import 'dotenv/config'
import { Client } from 'pg'
import { getProductBinaryPoolWeek } from '../src/app/lib/productBinaryPool'

const settingKey = 'product_binary_weekly_cutover'
const manilaOffset = 8 * 60 * 60 * 1000

async function main() {
  const date = process.argv[2]
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Usage: node --import tsx scripts/configure-product-binary-cutover.ts YYYY-MM-DD')
  }
  const start = new Date(date + 'T00:00:00+08:00')
  if (!Number.isFinite(start.getTime()) ||
      new Date(start.getTime() + manilaOffset).toISOString().slice(0, 10) !== date ||
      getProductBinaryPoolWeek(start).start.getTime() !== start.getTime()) {
    throw new Error('Choose a valid Monday in Philippine time.')
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL must point to the migration database.')
  const db = new Client({ connectionString, connectionTimeoutMillis: 10_000 })
  await db.connect()
  try {
    await db.query('BEGIN')
    await db.query("SELECT pg_advisory_xact_lock(hashtext('product-binary-weekly-cutover'))")
    const { rows: [state] } = await db.query<{ ready: boolean; existing: string | null; future: boolean }>(`
      SELECT to_regclass('public.product_binary_pool_allocations') IS NOT NULL
        AND to_regprocedure('public.close_product_binary_pool_week(date)') IS NOT NULL
        AND to_regprocedure('public.queue_product_binary_pool_order(uuid,timestamptz,integer)') IS NOT NULL
        AND to_regprocedure('public.credit_product_binary_pool_allocation(date,text)') IS NOT NULL AS ready,
        (SELECT value FROM public.system_settings WHERE key = $1) AS existing,
        $2::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date AS future
    `, [settingKey, date])
    if (!state.ready) throw new Error('Apply the weekly Product Binary migrations first.')
    if (state.existing !== null && state.existing !== date) {
      throw new Error('A different cutover already exists. Review existing payout records before changing it.')
    }
    if (state.existing === null) {
      if (!state.future) throw new Error('Choose a future Monday for the initial cutover.')
      await db.query(`
        INSERT INTO public.system_settings (id, key, value, updated_at)
        VALUES (gen_random_uuid()::text, $1, $2, CURRENT_TIMESTAMP)
      `, [settingKey, date])
    }
    await db.query('COMMIT')
    console.log(`Product Binary cutover confirmed for ${date} at 12:00 AM Philippine time.`)
  } finally {
    await db.end()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Unable to configure cutover.')
  process.exitCode = 1
})
