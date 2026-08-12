import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getNextPasskeyLastUsedAt,
  persistVerifiedPasskeyCounter,
  type PasskeyCounterSnapshot,
  type PasskeyCounterUpdate,
} from '../src/app/lib/passkeyCounter'

function createAtomicStore(initial: PasskeyCounterSnapshot) {
  let state = { ...initial }
  const updates: PasskeyCounterUpdate[] = []
  return {
    updates,
    state: () => state,
    updateMany: async (update: PasskeyCounterUpdate) => {
      await Promise.resolve()
      const sameTimestamp = state.last_used_at?.getTime() === update.where.last_used_at?.getTime()
      if (state.id !== update.where.id || state.counter !== update.where.counter || !sameTimestamp) return { count: 0 }
      state = { id: state.id, counter: update.data.counter, last_used_at: update.data.last_used_at }
      updates.push(update)
      return { count: 1 }
    },
  }
}

test('the compare-and-set timestamp is always later than its stored version', () => {
  const previous = new Date('2026-08-09T08:00:00.123Z')
  assert.equal(getNextPasskeyLastUsedAt(previous, new Date(previous)).getTime(), previous.getTime() + 1)
})

test('only one of two concurrent assertions can claim the same counter snapshot', async () => {
  const snapshot = { id: 'credential-1', counter: BigInt(3), last_used_at: new Date('2026-08-09T08:00:00.123Z') }
  const store = createAtomicStore(snapshot)
  const results = await Promise.all([
    persistVerifiedPasskeyCounter(snapshot, 4, false, 'singleDevice', store.updateMany),
    persistVerifiedPasskeyCounter(snapshot, 4, false, 'singleDevice', store.updateMany),
  ])
  assert.deepEqual(results.sort(), [false, true])
  assert.equal(store.updates.length, 1)
})

test('zero-counter authenticators still permit only one concurrent assertion', async () => {
  const snapshot = { id: 'credential-1', counter: BigInt(0), last_used_at: null }
  const store = createAtomicStore(snapshot)
  const now = new Date('2026-08-09T08:00:00.123Z')
  const results = await Promise.all([
    persistVerifiedPasskeyCounter(snapshot, 0, true, 'multiDevice', store.updateMany, now),
    persistVerifiedPasskeyCounter(snapshot, 0, true, 'multiDevice', store.updateMany, now),
  ])
  assert.deepEqual(results.sort(), [false, true])
  assert.equal(store.updates.length, 1)
})

test('a stale or failed atomic update cannot authorize a session', async () => {
  const stale = { id: 'credential-1', counter: BigInt(1), last_used_at: null }
  const persisted = await persistVerifiedPasskeyCounter(
    stale,
    2,
    false,
    'singleDevice',
    async () => ({ count: 0 }),
  )
  assert.equal(persisted, false)
})

test('a successful atomic update persists counter and authenticator metadata', async () => {
  const snapshot = { id: 'credential-1', counter: BigInt(1), last_used_at: null }
  const store = createAtomicStore(snapshot)
  assert.equal(await persistVerifiedPasskeyCounter(snapshot, 2, true, 'multiDevice', store.updateMany), true)
  assert.equal(store.state().counter, BigInt(2))
  assert.equal(store.updates[0].data.backed_up, true)
  assert.equal(store.updates[0].data.device_type, 'multiDevice')
})
