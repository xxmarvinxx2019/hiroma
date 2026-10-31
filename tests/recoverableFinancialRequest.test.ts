import assert from 'node:assert/strict'
import test from 'node:test'
import { pendingFinancialOperations, recoverableFinancialFetch, rememberFinancialOperation } from '../src/app/lib/recoverableFinancialRequest'

test('lost success response checks the original result without repeating a write or persisting credentials', async () => {
  const originalFetch = globalThis.fetch
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: () => true, setTimeout, clearTimeout } })
  const calls: string[] = []
  try {
    globalThis.fetch = (async (url: string) => {
      calls.push(url)
      if (calls.length === 1) throw new Error('response connection lost after commit')
      return Response.json({ state: 'completed', result: { success: true, operation_reference: 'FO-existing', reseller: { id: 'member' } } })
    }) as typeof fetch
    const response = await recoverableFinancialFetch('/api/city/resellers', { method: 'POST', body: JSON.stringify({ pin_id: 'pin-uuid', password: 'secret-password', identity_document_number: 'private-document' }) })
    assert.equal((await response.json()).operation_reference, 'FO-existing')
    assert.equal(calls.filter(url => url === '/api/city/resellers').length, 1)
    assert.match(calls[1], /financial-operations/)
    assert.deepEqual(pendingFinancialOperations(), [{ kind: 'registration', sourceId: 'pin-uuid' }])
    assert.ok(!JSON.stringify([...store.values()]).includes('secret-password'))
    assert.ok(!JSON.stringify([...store.values()]).includes('private-document'))
    rememberFinancialOperation({ kind: 'registration', sourceId: 'pin-uuid' }, true)
    assert.deepEqual(pendingFinancialOperations(), [])
    globalThis.fetch = (async () => { throw new Error('offline') }) as typeof fetch
    await assert.rejects(recoverableFinancialFetch('/api/city/resellers/upgrade', { method: 'PATCH', body: JSON.stringify({ new_pin_id: 'upgrade-pin' }) }), /Do not use a new PIN/)
    assert.deepEqual(pendingFinancialOperations(), [{ kind: 'upgrade', sourceId: 'upgrade-pin' }])
  } finally {
    globalThis.fetch = originalFetch
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage); else Reflect.deleteProperty(globalThis, 'localStorage')
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window')
  }
})
