import 'dotenv/config'
import assert from 'node:assert/strict'
import test from 'node:test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { returnPosShiftForRecount } from '../src/app/lib/posShiftRecount'
import { notificationUuid } from '../src/app/lib/notificationUuid'

test('PostgreSQL accepts the recount notification and preserves the terminal lock (rolled back)', { skip: process.env.POS_RECOUNT_DATABASE_TEST !== '1' }, async t => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  const rollback = new Error('Rollback verification only')
  try {
    const original = await prisma.posShift.findFirst({ where: { status: 'locally_closed' }, select: { id: true, owner_id: true, opened_by_id: true, active_terminal_key: true, closing_explanation: true } })
    if (!original) { t.skip('No pending shift is available for rollback verification'); return }
    await assert.rejects(prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM pos_shifts WHERE id = ${original.id}::uuid FOR UPDATE`
      const inventoryBefore = await tx.inventory.findMany({ where: { owner_id: original.owner_id }, select: { id: true, quantity: true, reserved_quantity: true }, orderBy: { id: 'asc' } })
      await returnPosShiftForRecount(tx, { shiftId: original.id, ownerId: original.owner_id, notes: 'Rollback test: recount cash and inventory.' })
      const returned = await tx.posShift.findUniqueOrThrow({ where: { id: original.id } })
      assert.equal(returned.status, 'needs_review')
      assert.equal(returned.active_terminal_key, original.active_terminal_key)
      const notice = await tx.notification.findUniqueOrThrow({ where: { id: notificationUuid(`pos-shift-recount:${original.id}`) } })
      assert.equal(notice.user_id, original.opened_by_id)
      assert.match(notice.message, /recount cash and inventory/)
      assert.equal(notice.read_at, null)
      const inventoryAfter = await tx.inventory.findMany({ where: { owner_id: original.owner_id }, select: { id: true, quantity: true, reserved_quantity: true }, orderBy: { id: 'asc' } })
      assert.deepEqual(inventoryAfter, inventoryBefore)
      throw rollback
    }, { timeout: 20000 }), error => error === rollback)
    const after = await prisma.posShift.findUniqueOrThrow({ where: { id: original.id }, select: { id: true, owner_id: true, opened_by_id: true, active_terminal_key: true, closing_explanation: true } })
    assert.deepEqual(after, original)
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
})
