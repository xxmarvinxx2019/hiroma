import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Client } from 'pg'
import type { Prisma } from '@prisma/client'
import { loadSupplierOrderCatalog, OrderingSupplierChangedError } from '../src/app/lib/orderingSupplier'
import { reserveOrderStock } from '../src/app/lib/inventoryReservation'

const connection = () => new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
function rawAdapter(db: Client) {
  return {
    $queryRaw: async (query: Prisma.Sql) => (await db.query(query.text, [...query.values])).rows,
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '')
      return (await db.query(sql, values)).rowCount
    },
  }
}

test('supplier catalog exposes only available stock and buyer prices; reservations reject overselling', { skip: !process.env.DATABASE_URL }, async () => {
  const db = connection(); await db.connect(); await db.query('BEGIN')
  try {
    const schema = `supplier_test_${randomUUID().replaceAll('-', '')}`
    await db.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}",public`)
    await db.query(`
      CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,type TEXT,is_active BOOLEAN,price NUMERIC,cost_price NUMERIC,regional_price NUMERIC,provincial_price NUMERIC,city_price NUMERIC,branch_price NUMERIC);
      CREATE TABLE distributor_profiles(id TEXT PRIMARY KEY,user_id TEXT,dist_level TEXT);
      CREATE TABLE product_area_visibility(distributor_id TEXT,product_id TEXT,is_visible BOOLEAN);
      CREATE TABLE inventory(owner_id TEXT,product_id TEXT,quantity INT,reserved_quantity INT,updated_at TIMESTAMPTZ,UNIQUE(owner_id,product_id));
      INSERT INTO distributor_profiles VALUES('city-profile','city','city'),('province-profile','provincial','provincial'),('region-profile','regional','regional');
      INSERT INTO products VALUES('bottle','Bottle','physical',true,200,100,150,155,163,160),('empty','No stock','physical',true,200,100,150,155,163,160),('hidden','Hidden','physical',true,200,100,150,155,163,160),('inactive','Inactive','physical',false,200,100,150,155,163,160),('reserved','Fully reserved','physical',true,200,100,150,155,163,160);
      INSERT INTO inventory VALUES('province','bottle',10,7,now()),('region','bottle',9,1,now()),('admin','bottle',20,4,now()),('unrelated','bottle',999,0,now()),('province','reserved',4,4,now());
      INSERT INTO product_area_visibility VALUES('city-profile','hidden',false),('province-profile','hidden',false),('region-profile','hidden',false);
    `)
    const adapter = { ...rawAdapter(db), distributorProfile: {
      findUnique: async ({ where }: { where: { user_id: string } }) => ({ is_active: true, dist_level: where.user_id, province_code: 'P1', region_code: 'R1' }),
      findFirst: async ({ where }: { where: { dist_level: string } }) => ({ user: { id: where.dist_level === 'provincial' ? 'province' : 'region', full_name: 'Supplier', username: 'supplier' } }),
    }, user: { findFirst: async () => ({ id: 'admin', full_name: 'Hiroma', username: 'hiroma' }) } } as unknown as Parameters<typeof loadSupplierOrderCatalog>[0]
    const city = await loadSupplierOrderCatalog(adapter, 'city', 'city', 'province')
    assert.equal(city.supplier?.id, 'province')
    assert.equal(city.products.find(p => p.id === 'bottle')?.available_quantity, 3)
    assert.equal(city.products.find(p => p.id === 'bottle')?.price, 163)
    assert.equal(city.products.find(p => p.id === 'empty')?.available_quantity, 0)
    assert.equal(city.products.find(p => p.id === 'reserved')?.available_quantity, 0)
    assert.ok(!city.products.some(p => p.id === 'hidden' || p.id === 'inactive'))
    assert.ok(city.products.every(p => !('cost_price' in p) && !('reserved_quantity' in p) && !('owner_id' in p)))
    await assert.rejects(loadSupplierOrderCatalog(adapter, 'city', 'city', 'unrelated'), OrderingSupplierChangedError)
    const provincial = await loadSupplierOrderCatalog(adapter, 'provincial', 'provincial', 'region')
    assert.equal(provincial.products.find(p => p.id === 'bottle')?.available_quantity, 8)
    assert.equal(provincial.products.find(p => p.id === 'bottle')?.price, 155)
    const regional = await loadSupplierOrderCatalog(adapter, 'regional', 'regional', 'admin')
    assert.equal(regional.products.find(p => p.id === 'bottle')?.available_quantity, null)
    assert.equal(regional.products.find(p => p.id === 'bottle')?.is_available, true)
    assert.equal(regional.products.find(p => p.id === 'empty')?.is_available, false)
    assert.ok(regional.products.every(p => p.available_quantity === null))
    assert.equal(regional.products.find(p => p.id === 'bottle')?.price, 150)
    const stockTx = rawAdapter(db) as unknown as Prisma.TransactionClient
    await reserveOrderStock(stockTx, 'province', [{ product_id: 'bottle', quantity: 3 }])
    assert.equal((await loadSupplierOrderCatalog(adapter, 'city', 'city', 'province')).products.find(p => p.id === 'bottle')?.available_quantity, 0)
    await assert.rejects(reserveOrderStock(stockTx, 'province', [{ product_id: 'bottle', quantity: 1 }]), /Insufficient available stock/)
    assert.equal((await db.query("SELECT reserved_quantity FROM inventory WHERE owner_id='province' AND product_id='bottle'")).rows[0].reserved_quantity, 10)
    await db.query("INSERT INTO inventory VALUES('province','empty',2,0,now())")
    await db.query('SAVEPOINT failed_multi_item_order')
    await assert.rejects(reserveOrderStock(stockTx, 'province', [{ product_id: 'empty', quantity: 1 }, { product_id: 'bottle', quantity: 1 }]), /Insufficient available stock/)
    // The checkout wraps every reservation and order write in one transaction.
    await db.query('ROLLBACK TO SAVEPOINT failed_multi_item_order')
    assert.equal((await db.query("SELECT reserved_quantity FROM inventory WHERE owner_id='province' AND product_id='empty'")).rows[0].reserved_quantity, 0)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('simultaneous orders cannot reserve the same final supplier stock', { skip: !process.env.DATABASE_URL }, async () => {
  const setup = connection(); await setup.connect()
  const schema = `supplier_race_${randomUUID().replaceAll('-', '')}`
  const peers: Client[] = []
  try {
    await setup.query(`CREATE SCHEMA "${schema}"; CREATE TABLE "${schema}".inventory(owner_id TEXT,product_id TEXT,quantity INT,reserved_quantity INT,updated_at TIMESTAMPTZ); INSERT INTO "${schema}".inventory VALUES('supplier','bottle',10,7,now())`)
    const outcomes = await Promise.all([1, 2].map(async () => {
      const db = connection(); peers.push(db); await db.connect()
      try {
        await db.query('BEGIN'); await db.query(`SET LOCAL search_path TO "${schema}",public`); await db.query("SET LOCAL lock_timeout='10s'")
        await reserveOrderStock(rawAdapter(db) as unknown as Prisma.TransactionClient, 'supplier', [{ product_id: 'bottle', quantity: 3 }])
        await db.query('COMMIT'); return true
      } catch { await db.query('ROLLBACK'); return false }
    }))
    assert.equal(outcomes.filter(Boolean).length, 1)
    assert.equal((await setup.query(`SELECT reserved_quantity FROM "${schema}".inventory`)).rows[0].reserved_quantity, 10)
  } finally { await Promise.all(peers.map(db => db.end())); await setup.query(`DROP SCHEMA "${schema}" CASCADE`); await setup.end() }
})
