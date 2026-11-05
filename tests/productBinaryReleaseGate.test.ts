import assert from 'node:assert/strict'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { isProductBinaryReleaseApproved } from '../src/app/lib/productBinaryReleaseGate'

test('production Product Binary holds payouts until the exact release and database are ready', async t => {
  const keys = ['VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA', 'PRODUCT_BINARY_APPROVED_RELEASE_SHA'] as const
  const previous = keys.map(key => process.env[key])
  t.after(() => {
    keys.forEach((key, index) => {
      const value = previous[index]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  })
  let reads = 0
  let ready = false
  const db = {
    $queryRaw: async () => {
      reads++
      return [{ ready }]
    },
  } as unknown as Pick<Prisma.TransactionClient, '$queryRaw'>

  process.env.VERCEL_ENV = 'production'
  process.env.VERCEL_GIT_COMMIT_SHA = 'a'.repeat(40)
  delete process.env.PRODUCT_BINARY_APPROVED_RELEASE_SHA
  assert.equal(await isProductBinaryReleaseApproved(db), false)
  process.env.PRODUCT_BINARY_APPROVED_RELEASE_SHA = 'b'.repeat(40)
  assert.equal(await isProductBinaryReleaseApproved(db), false)
  assert.equal(reads, 0)

  process.env.PRODUCT_BINARY_APPROVED_RELEASE_SHA = 'a'.repeat(40)
  assert.equal(await isProductBinaryReleaseApproved(db), false)
  ready = true
  assert.equal(await isProductBinaryReleaseApproved(db), true)
})
