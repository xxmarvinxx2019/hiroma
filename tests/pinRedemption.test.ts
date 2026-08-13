import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { claimUnusedPin, PinAlreadyClaimedError } from '../src/app/lib/pinRedemption'

function pinClaimStore() {
  let status = 'unused'
  return {
    tx: {
      pin: {
        updateMany: async ({ where }: { where: { status: string } }) => {
          if (status !== where.status) return { count: 0 }
          status = 'used'
          return { count: 1 }
        },
      },
    } as unknown as Prisma.TransactionClient,
    status: () => status,
  }
}

test('only one of two concurrent attempts can claim an unused PIN', async () => {
  const store = pinClaimStore()
  const results = await Promise.allSettled([
    claimUnusedPin(store.tx, 'pin-a', 'reseller-a'),
    claimUnusedPin(store.tx, 'pin-a', 'reseller-b'),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.ok(rejected && rejected.status === 'rejected' && rejected.reason instanceof PinAlreadyClaimedError)
  assert.equal(store.status(), 'used')
})

test('registration and upgrade claim the PIN before financial side effects', () => {
  for (const path of [
    'src/app/api/admin/resellers/register/route.ts',
    'src/app/api/city/resellers/route.ts',
    'src/app/api/city/resellers/upgrade/route.ts',
  ]) {
    const source = readFileSync(path, 'utf8')
    const claim = source.indexOf('claimUnusedPin(tx, pin.id')
    const financial = Math.max(source.indexOf('tx.registrationFinancial.create'), source.indexOf('tx.upgradeFinancial.create'))
    assert.ok(claim >= 0 && financial >= 0 && claim < financial, `${path} must claim before financial writes`)
  }
})

test('new-account routes reject upgrade PINs', () => {
  for (const path of [
    'src/app/api/admin/resellers/register/route.ts',
    'src/app/api/city/resellers/route.ts',
  ]) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /pin\.pin_type !== "registration"/)
  }
})
