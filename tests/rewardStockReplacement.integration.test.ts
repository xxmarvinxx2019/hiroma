import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Client } from 'pg'
import { createRewardStockFixture } from './fixtures/rewardStockFixture'
import { loadRewardStockWorkspace } from '../src/app/lib/rewardStockReplacement'
import type { Prisma } from '@prisma/client'
import type { JWTPayload } from '../src/app/lib/auth'

const connection = () => new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })

test('one original obligation moves up the supplier chain and branch replenishment stays internal', { skip: !process.env.DATABASE_URL }, async () => {
  const db = connection(); await db.connect(); await db.query('BEGIN')
  try {
    const fixture = await createRewardStockFixture(db)
    await fixture.release('outletB', 2); await fixture.release('outletA', 1)
    const adapter = { $queryRaw: async (query: Prisma.Sql) => (await db.query(query.text, [...query.values])).rows } as Pick<Prisma.TransactionClient, '$queryRaw'>
    const user = (id: string, role: JWTPayload['role']) => ({ id, role, username: id, full_name: id })
    const cityView = await loadRewardStockWorkspace(adapter, user('outletB', 'city'), 1)
    assert.equal(cityView.summary.pending, 2)
    assert.equal(cityView.groups.length, 1)
    assert.equal(cityView.groups[0].can_supply, false)
    const adminView = await loadRewardStockWorkspace(adapter, user('hiroma', 'admin'), 1)
    assert.equal(adminView.summary.global_open, 3)
    assert.equal(adminView.groups.length, 2)
    const provinceView = await loadRewardStockWorkspace(adapter, user('provincial', 'provincial'), 1)
    assert.equal(provinceView.groups.length, 1)
    assert.equal(provinceView.groups[0].recipient_id, 'outletB')
    assert.equal(provinceView.groups[0].available_stock, 10)
    assert.equal((await loadRewardStockWorkspace(adapter, user('hiroma', 'admin'), 1, 'Branch A')).groups.length, 1)
    const count = async (sql: string) => Number((await db.query(sql)).rows[0].n)
    const stock = (owner: string) => count(`SELECT quantity n FROM inventory WHERE owner_id='${owner}' AND product_id='bottle'`)
    const dispatch = async (supplier: string, recipient: string, quantity: number, kind = 'distributor_replacement', actor = supplier) => (
      await db.query('INSERT INTO reward_stock_dispatches(client_request_id,supplier_id,recipient_id,actor_id,product_id,kind,quantity) VALUES($1,$2,$3,$4,\'bottle\',$5,$6) RETURNING id::text', [randomUUID(), supplier, recipient, actor, kind, quantity])).rows[0].id as string
    const receive = (id: string, actor: string) => db.query('INSERT INTO reward_stock_receipts(dispatch_id,actor_id) VALUES($1,$2)', [id, actor])
    async function reject(action: () => Promise<unknown>, pattern: RegExp) {
      await db.query('SAVEPOINT invalid_replacement'); await assert.rejects(action, pattern); await db.query('ROLLBACK TO SAVEPOINT invalid_replacement')
    }
    assert.equal(await count('SELECT count(*) n FROM reward_stock_units'), 3)
    assert.equal(await count("SELECT count(*) n FROM reward_stock_units WHERE kind='internal_replenishment'"), 1)
    await reject(() => dispatch('provincial', 'outletA', 1, 'internal_replenishment'), /authorized upstream supplier/)
    await reject(() => dispatch('outsider', 'outletB', 1), /authorized upstream supplier/)
    await reject(() => dispatch('outletB', 'provincial', 1), /authorized upstream supplier/)
    await reject(() => dispatch('provincial', 'outletB', 1, 'distributor_replacement', 'staff'), /authorized upstream supplier/)
    await db.query("UPDATE inventory SET reserved_quantity=quantity WHERE owner_id='provincial'")
    await reject(() => dispatch('provincial', 'outletB', 1), /Not enough available supplier stock/)
    await db.query("UPDATE inventory SET reserved_quantity=0 WHERE owner_id='provincial'")
    await reject(() => dispatch('provincial', 'outletB', 3), /Not enough pending/)
    assert.equal(await stock('provincial'), 10)
    const toCity = await dispatch('provincial', 'outletB', 2)
    assert.equal(await stock('provincial'), 8); assert.equal(await stock('outletB'), 18)
    assert.equal(await count("SELECT count(*) n FROM reward_stock_units WHERE holder_id='provincial'"), 0)
    await reject(() => dispatch('regional', 'outletB', 1), /Not enough pending/)
    await reject(() => receive(toCity, 'regional'), /authorized recipient/)
    await receive(toCity, 'outletB')
    assert.equal(await stock('outletB'), 20)
    assert.equal(await count("SELECT count(*) n FROM reward_stock_units WHERE holder_id='provincial' AND current_dispatch_id IS NULL"), 2)
    await reject(() => receive(toCity, 'outletB'), /already received/)
    assert.equal(await stock('outletB'), 20)
    const toProvince = await dispatch('regional', 'provincial', 1)
    await receive(toProvince, 'provincial')
    assert.equal(await stock('provincial'), 9); assert.equal(await stock('regional'), 9)
    assert.equal(await count("SELECT count(*) n FROM reward_stock_units WHERE holder_id='regional'"), 1)
    const toRegion = await dispatch('hiroma', 'regional', 1)
    await receive(toRegion, 'regional')
    const directProvince = await dispatch('hiroma', 'provincial', 1)
    await receive(directProvince, 'provincial')
    const branch = await dispatch('hiroma', 'outletA', 1, 'internal_replenishment')
    assert.equal(await stock('outletA'), 19)
    await receive(branch, 'outletA')
    assert.equal(await stock('outletA'), 20)
    assert.equal(await stock('provincial'), 10); assert.equal(await stock('regional'), 10); assert.equal(await stock('hiroma'), 97)
    assert.equal(await count('SELECT count(*) n FROM reward_stock_units'), 3)
    assert.equal(await count('SELECT count(*) n FROM reward_stock_units WHERE settled_at IS NOT NULL AND holder_id IS NULL'), 3)
    assert.equal(await count("SELECT count(*) n FROM reward_stock_units WHERE kind='internal_replenishment' AND cycle=1"), 1)
    await reject(() => dispatch('hiroma', 'outletA', 1, 'internal_replenishment'), /Not enough pending/)
    await reject(() => db.query('DELETE FROM reward_stock_units'), /recorded release or receipt/)
    await reject(() => db.query('DELETE FROM reward_stock_dispatches'), /append-only/)
    assert.equal(await count("SELECT count(*) n FROM inventory_audit_events WHERE event_type IN ('reward_replacement_dispatch','reward_replacement_received')"), 10)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('two upstream suppliers cannot dispatch the same pending bottle twice', { skip: !process.env.DATABASE_URL }, async () => {
  const setup = connection(); await setup.connect()
  let schema = ''
  const peers: Client[] = []
  try {
    await setup.query('BEGIN')
    const fixture = await createRewardStockFixture(setup); schema = fixture.schema
    await fixture.release('outletB', 1); await setup.query('COMMIT')
    const outcomes = await Promise.all(['provincial', 'regional'].map(async supplier => {
      const db = connection(); peers.push(db); await db.connect()
      try {
        await db.query('BEGIN'); await db.query(`SET LOCAL search_path TO "${schema}",public`); await db.query("SET LOCAL lock_timeout='10s'")
        await db.query("INSERT INTO reward_stock_dispatches(client_request_id,supplier_id,recipient_id,actor_id,product_id,kind,quantity) VALUES($1,$2,'outletB',$2,'bottle','distributor_replacement',1)", [randomUUID(), supplier])
        await db.query('COMMIT'); return true
      } catch { await db.query('ROLLBACK'); return false }
    }))
    assert.equal(outcomes.filter(Boolean).length, 1)
    await setup.query('BEGIN'); await setup.query(`SET LOCAL search_path TO "${schema}",public`)
    assert.equal((await setup.query('SELECT count(*)::int n FROM reward_stock_dispatches')).rows[0].n, 1)
    assert.equal((await setup.query('SELECT count(*)::int n FROM reward_stock_units')).rows[0].n, 1)
    assert.equal((await setup.query("SELECT sum(quantity)::int n FROM inventory WHERE owner_id IN ('provincial','regional')")).rows[0].n, 19)
    await setup.query('COMMIT')
    const dispatchId = (await setup.query(`SELECT id::text FROM "${schema}".reward_stock_dispatches`)).rows[0].id
    const receipts = await Promise.all(peers.map(async db => {
      try {
        await db.query('BEGIN'); await db.query(`SET LOCAL search_path TO "${schema}",public`)
        await db.query("INSERT INTO reward_stock_receipts(dispatch_id,actor_id) VALUES($1,'outletB')", [dispatchId])
        await db.query('COMMIT'); return true
      } catch { await db.query('ROLLBACK'); return false }
    }))
    assert.equal(receipts.filter(Boolean).length, 1)
    assert.equal((await setup.query(`SELECT quantity FROM "${schema}".inventory WHERE owner_id='outletB'`)).rows[0].quantity, 20)
    assert.equal((await setup.query(`SELECT count(*)::int n FROM "${schema}".reward_stock_receipts`)).rows[0].n, 1)
  } finally {
    await setup.query('ROLLBACK'); await Promise.all(peers.map(db => db.end()))
    if (schema) await setup.query(`DROP SCHEMA "${schema}" CASCADE`)
    await setup.end()
  }
})

test('migration backfills real historical releases once and flags current-profile classification', { skip: !process.env.DATABASE_URL }, async () => {
  const db = connection(); await db.connect(); await db.query('BEGIN')
  try {
    const fixture = await createRewardStockFixture(db, true)
    const before = (await db.query('SELECT kind,classification_source FROM reward_stock_units ORDER BY kind')).rows
    assert.equal(before.length, 2)
    assert.ok(before.every(row => row.classification_source === 'legacy_current_profile'))
    assert.deepEqual(new Set(before.map(row => row.kind)), new Set(['distributor_replacement', 'internal_replenishment']))
    await fixture.release('outletB', 1)
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM reward_stock_units')).rows[0].n, 3)
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM reward_stock_units WHERE classification_source='claim'")).rows[0].n, 1)
  } finally { await db.query('ROLLBACK'); await db.end() }
})
