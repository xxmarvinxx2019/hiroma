import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaClient } from '@prisma/client'

test('weekly release continues after a batch that only retains expired bonuses', async () => {
  const week = '2020-06-15'
  const batches = [
    { credited: 0, complete: false },
    { credited: 1, complete: false },
    { credited: 0, complete: true },
  ]
  let batchIndex = 0
  let complete = false
  const original = globalThis.prisma
  globalThis.prisma = {
    async $queryRaw(sql: TemplateStringsArray) {
      const query = sql.join('?')
      if (query.includes('FROM pg_attribute')) return [{ ready: true, deferred: false, expiry: false }]
      if (query.includes('time \'10:00\'')) return [{ week }]
      if (query.includes('COUNT(*)::int AS pending')) return [{ pending: complete ? 0 : 1 }]
      return []
    },
    async $transaction(run: (tx: unknown) => Promise<unknown>) {
      const batch = batches[batchIndex++]
      assert.ok(batch, 'Expected the worker to stop when the week is released')
      const result = await run({
        async $queryRaw(sql: TemplateStringsArray) {
          const query = sql.join('?')
          if (query.includes('release_product_binary_pool_week')) return [{ credited: batch.credited }]
          if (query.includes('released_at IS NOT NULL AS complete')) return [{ complete: batch.complete }]
          assert.match(query, /set_config/)
          return []
        },
        async $executeRaw() {},
      })
      complete = batch.complete
      return result
    },
  } as unknown as PrismaClient

  try {
    const { settleClosedProductBinaryPools } = await import('../src/app/lib/productBinaryPoolSettlement')
    const result = await settleClosedProductBinaryPools()
    assert.equal(batchIndex, 3)
    assert.equal(result.credited, 1)
    assert.equal(result.pending, 0)
    assert.equal(result.failed, 0)
  } finally {
    globalThis.prisma = original
  }
})
