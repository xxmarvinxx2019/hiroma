import assert from 'node:assert/strict'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import { notificationUuid } from '../src/app/lib/notificationUuid'
import { returnPosShiftForRecount, PosShiftRecountConflictError } from '../src/app/lib/posShiftRecount'

test('notification IDs use standard UUID v5 and keep retries stable', () => {
  assert.equal(notificationUuid('python.org'), '886313e1-3b8a-5372-9b90-0c9aee199e5d')
  const id = notificationUuid('pos-shift-recount:shift-a')
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(id, notificationUuid('pos-shift-recount:shift-a'))
  assert.notEqual(id, notificationUuid('pos-shift-recount:shift-b'))
})

test('return sends the finding to the original cashier and makes repeat findings unread', async () => {
  let state: unknown
  let notification: Prisma.NotificationUpsertArgs | undefined
  const tx = {
    posShift: {
      findFirst: async () => ({ id: 'shift-a', opened_by_id: 'cashier-a' }),
      updateMany: async (args: Prisma.PosShiftUpdateManyArgs) => { state = args.data; return { count: 1 } },
    },
    notification: { upsert: async (args: Prisma.NotificationUpsertArgs) => { notification = args } },
  } as unknown as Prisma.TransactionClient
  await returnPosShiftForRecount(tx, { shiftId: 'shift-a', ownerId: 'branch-a', notes: 'Cash is short. Recount the drawer.' })
  assert.deepEqual(state, { status: 'needs_review', closing_explanation: 'Cash is short. Recount the drawer.' })
  assert.equal(notification?.create.user_id, 'cashier-a')
  assert.match(String(notification?.create.message), /Cash is short/)
  assert.equal(notification?.update.read_at, null)
  assert.equal(notification?.create.action_url, '/dashboard/city/pos/history?shift_id=shift-a')
  assert.equal(notification?.where.id, notificationUuid('pos-shift-recount:shift-a'))
})

test('a stale review aborts instead of notifying or reopening the shift', async () => {
  const tx = {
    posShift: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
    notification: { upsert: async () => { assert.fail('No notification should be written') } },
  } as unknown as Prisma.TransactionClient
  await assert.rejects(returnPosShiftForRecount(tx, { shiftId: 'shift-a', ownerId: 'branch-a', notes: 'Recount inventory.' }), PosShiftRecountConflictError)
})
