import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Client } from 'pg'
import { createRewardStockFixture } from './fixtures/rewardStockFixture'
import { parseOrderReplacements } from '../src/app/lib/orderReplacements'
import { reserveOrderStock } from '../src/app/lib/inventoryReservation'
import { Prisma } from '@prisma/client'

test('replacement selection validates whole bottles and duplicate lines', () => {
  assert.deepEqual(parseOrderReplacements(undefined), [])
  for (const value of [null, {}, [{ product_id: 'a', kind: 'cash', quantity: 1 }], [{ product_id: 'a', kind: 'distributor_replacement', quantity: 0.5 }], Array(2).fill({ product_id: 'a', kind: 'distributor_replacement', quantity: 1 })]) assert.throws(() => parseOrderReplacements(value), /Invalid replacement/)
})

async function fixture(db: Client) {
  const f = await createRewardStockFixture(db)
  return f
}
const connect = () => new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })

test('combined order reserves credits and stock, cancels atomically, and receives free bottles exactly once', { skip: !process.env.DATABASE_URL }, async () => {
  const db = connect(); await db.connect(); await db.query('BEGIN')
  try {
    const f = await fixture(db); await f.release('outletB', 3)
    const count = async (query: string) => Number((await db.query(query)).rows[0].n)
    const reserve = async (order: string, qty: number, seller = 'hiroma', actor = 'outletB') => {
      await db.query('INSERT INTO orders VALUES($1,\'outletB\',$2,\'pending\')', [order, seller])
      return (await db.query("INSERT INTO order_replacement_requests(order_id,actor_id,product_id,kind,quantity) VALUES($1,$2,'bottle','distributor_replacement',$3) RETURNING id", [order, actor, qty])).rows[0].id as string
    }
    async function reject(action: () => Promise<unknown>, pattern: RegExp) {
      await db.query('SAVEPOINT invalid_combined'); await assert.rejects(action, pattern); await db.query('ROLLBACK TO SAVEPOINT invalid_combined')
    }
    // Paid reservation and replacement reservation are one transaction, including failures.
    await db.query('SAVEPOINT checkout_rollback')
    await db.query("UPDATE inventory SET quantity=2 WHERE owner_id='hiroma'")
    const adapter = { $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { const query = Prisma.sql(strings, ...values); return (await db.query(query.text, [...query.values])).rowCount } } as Prisma.TransactionClient
    await reserveOrderStock(adapter, 'hiroma', [{ product_id: 'bottle', quantity: 2 }])
    await assert.rejects(reserve('paid-and-free', 1), /stock is currently unavailable/)
    await db.query('ROLLBACK TO SAVEPOINT checkout_rollback')
    assert.equal(await count("SELECT reserved_quantity n FROM inventory WHERE owner_id='hiroma'"), 0)
    assert.equal(await count("SELECT COUNT(*) n FROM order_replacement_requests WHERE order_id='paid-and-free'"), 0)
    await reject(() => reserve('unauthorized', 1, 'outsider'), /supplier is not authorized/)
    await reject(() => reserve('wrongactor', 1, 'hiroma', 'member'), /Only pending purchase/)
    const request = await reserve('combined', 2)
    assert.equal(await count("SELECT reserved_quantity n FROM inventory WHERE owner_id='hiroma'"), 2)
    await reject(() => reserve('double', 2), /already reserved/)
    // Unrelated direct dispatch cannot consume the two credits attached to this order.
    await reject(() => db.query("INSERT INTO reward_stock_dispatches(client_request_id,supplier_id,recipient_id,actor_id,product_id,kind,quantity) VALUES($1,'hiroma','outletB','hiroma','bottle','distributor_replacement',2)", [randomUUID()]), /Not enough pending/)
    await db.query("UPDATE orders SET status='processing' WHERE id='combined'")
    assert.equal(await count('SELECT COUNT(*) n FROM reward_stock_dispatches'), 0)
    await db.query("UPDATE orders SET status='delivered' WHERE id='combined'")
    assert.equal(await count("SELECT quantity n FROM inventory WHERE owner_id='hiroma'"), 98)
    assert.equal(await count("SELECT reserved_quantity n FROM inventory WHERE owner_id='hiroma'"), 0)
    assert.equal(await count("SELECT quantity n FROM inventory WHERE owner_id='outletB'"), 17)
    assert.equal(await count('SELECT COUNT(*) n FROM reward_stock_dispatches'), 1)
    await db.query("UPDATE orders SET status='delivered' WHERE id='combined'")
    assert.equal(await count('SELECT COUNT(*) n FROM reward_stock_dispatches'), 1)
    await db.query('INSERT INTO reward_stock_receipts(dispatch_id,actor_id) VALUES($1,\'outletB\')', [request])
    assert.equal(await count("SELECT quantity n FROM inventory WHERE owner_id='outletB'"), 19)
    assert.equal(await count('SELECT COUNT(*) n FROM reward_stock_units WHERE settled_at IS NOT NULL'), 2)
    await reject(() => db.query('INSERT INTO reward_stock_receipts(dispatch_id,actor_id) VALUES($1,\'outletB\')', [request]), /already received/)
    await reserve('cancelled', 1)
    await db.query("UPDATE orders SET status='cancelled' WHERE id='cancelled'")
    assert.equal(await count("SELECT reserved_quantity n FROM inventory WHERE owner_id='hiroma'"), 0)
    await reserve('retry', 1)
    await reject(() => db.query("UPDATE order_replacement_requests SET state='cancelled' WHERE order_id='retry'"), /history is protected/)
    // Paid stock and free stock share one inventory reservation pool.
    await db.query("UPDATE inventory SET reserved_quantity=quantity WHERE owner_id='hiroma'")
    await db.query("UPDATE orders SET status='cancelled' WHERE id='retry'")
    await db.query("UPDATE inventory SET reserved_quantity=quantity WHERE owner_id='hiroma'")
    await reject(() => reserve('nostock', 1), /stock is currently unavailable/)
    assert.equal(await count("SELECT COUNT(*) n FROM order_replacement_requests WHERE order_id='nostock'"), 0)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('combined replacement preserves the original upstream obligation and restricts company branches to Hiroma', { skip: !process.env.DATABASE_URL }, async () => {
  const db = connect(); await db.connect(); await db.query('BEGIN')
  try {
    const f = await fixture(db); await f.release('outletA', 1); await f.release('outletB', 1)
    async function request(order: string, buyer: string, supplier: string, kind: string) {
      await db.query('INSERT INTO orders VALUES($1,$2,$3,\'pending\')', [order, buyer, supplier])
      return (await db.query("INSERT INTO order_replacement_requests(order_id,actor_id,product_id,kind,quantity) VALUES($1,$2,'bottle',$3,1) RETURNING id", [order, buyer, kind])).rows[0].id as string
    }
    await db.query('SAVEPOINT branch_supplier')
    await assert.rejects(request('wrong', 'outletA', 'provincial', 'internal_replenishment'), /supplier is not authorized/)
    await db.query('ROLLBACK TO SAVEPOINT branch_supplier')
    const branch = await request('branch', 'outletA', 'hiroma', 'internal_replenishment')
    const city = await request('city', 'outletB', 'provincial', 'distributor_replacement')
    await db.query("UPDATE orders SET status='delivered' WHERE id IN ('branch','city')")
    await db.query("INSERT INTO reward_stock_receipts(dispatch_id,actor_id) VALUES($1,'outletA'),($2,'outletB')", [branch, city])
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM reward_stock_units WHERE holder_id='provincial'")).rows[0].n, 1)
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM reward_stock_units WHERE settled_at IS NOT NULL')).rows[0].n, 1)
    const upstream = await request('upstream', 'provincial', 'regional', 'distributor_replacement')
    await db.query("UPDATE orders SET status='delivered' WHERE id='upstream'")
    await db.query("INSERT INTO reward_stock_receipts(dispatch_id,actor_id) VALUES($1,'provincial')", [upstream])
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM reward_stock_units')).rows[0].n, 2)
    assert.equal((await db.query("SELECT COUNT(*)::int n FROM reward_stock_units WHERE holder_id='regional' AND cycle=2")).rows[0].n, 1)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('competing orders cannot reserve the same replacement credit', { skip: !process.env.DATABASE_URL }, async () => {
  const db = connect(); await db.connect(); const peers: Client[] = []; let schema = ''
  try {
    await db.query('BEGIN'); const f = await fixture(db); schema = f.schema; await f.release('outletB', 1)
    await db.query("INSERT INTO orders VALUES('one','outletB','hiroma','pending'),('two','outletB','hiroma','pending')"); await db.query('COMMIT')
    const results = await Promise.all(['one', 'two'].map(async id => {
      const peer = connect(); peers.push(peer); await peer.connect(); await peer.query('BEGIN'); await peer.query(`SET LOCAL search_path TO "${schema}",public`)
      try { await peer.query("INSERT INTO order_replacement_requests(order_id,actor_id,product_id,kind,quantity) VALUES($1,'outletB','bottle','distributor_replacement',1)", [id]); await peer.query('COMMIT'); return true }
      catch { await peer.query('ROLLBACK'); return false }
    }))
    assert.equal(results.filter(Boolean).length, 1)
    assert.equal(Number((await db.query(`SELECT reserved_quantity FROM "${schema}".inventory WHERE owner_id='hiroma'`)).rows[0].reserved_quantity), 1)
  } finally { await Promise.all(peers.map(peer => peer.end())); if (schema) await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.end() }
})
