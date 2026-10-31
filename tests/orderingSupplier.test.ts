import assert from 'node:assert/strict'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { assertOrderingSupplier, OrderingSupplierChangedError, resolveOrderingSupplier } from '../src/app/lib/orderingSupplier'

type Db = Pick<Prisma.TransactionClient, 'distributorProfile' | 'user'>
test('orders prioritize the provincial territory, then regional, then Hiroma without consulting stock', async () => {
  const profile = { is_active: true, dist_level: 'city', province_code: 'P1', region_code: 'R1', parent: { user: { id: 'wrong-territory' } } }
  let provincialActive = true, regionalActive = true
  const db = { distributorProfile: { findUnique: async () => profile, findFirst: async ({ where }: { where: Record<string, unknown> }) => {
    assert.equal(where.is_active, true)
    assert.equal(where.region_code, 'R1')
    if (where.dist_level === 'provincial') {
      assert.equal(where.province_code, 'P1')
      return provincialActive ? { user: { id: 'province', full_name: 'Province', username: 'province' } } : null
    }
    return regionalActive ? { user: { id: 'region', full_name: 'Region', username: 'region' } } : null
  } },
    user: { findFirst: async () => ({ id: 'admin', full_name: 'Hiroma', username: 'hiroma' }) } } as unknown as Db
  assert.equal((await resolveOrderingSupplier(db, 'city', 'city'))?.id, 'province')
  provincialActive = false
  assert.equal((await resolveOrderingSupplier(db, 'city', 'city'))?.id, 'region')
  regionalActive = false
  assert.equal((await resolveOrderingSupplier(db, 'city', 'city'))?.id, 'admin')
  assert.equal(await resolveOrderingSupplier(db, 'city', 'regional'), null)
  profile.is_active = false
  assert.equal(await resolveOrderingSupplier(db, 'city', 'city'), null)
})

test('a selected or stale supplier cannot be replaced silently by another account', () => {
  const supplier = { id: 'province', full_name: 'Province', username: 'province', level: 'Provincial Distributor' }
  assert.doesNotThrow(() => assertOrderingSupplier('province', supplier))
  assert.doesNotThrow(() => assertOrderingSupplier(undefined, supplier))
  for (const selected of ['unrelated', '', 4, { id: 'province' }]) assert.throws(() => assertOrderingSupplier(selected, supplier), OrderingSupplierChangedError)
  assert.throws(() => assertOrderingSupplier('province', null), OrderingSupplierChangedError)
})
