import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Client } from 'pg'
import { addProductPuLot, consumeProductPuFifo, expireProductPu } from '../src/app/lib/productBinaryExpiry'

test('Product PU migration, FIFO, individual expiry and delayed settlement', { skip: !process.env.DATABASE_URL }, async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    const schema = `pu_expiry_test_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}", public`)
    await client.query(`
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE product_binary_positions(user_id TEXT PRIMARY KEY,left_carryover_pu INT DEFAULT 0,right_carryover_pu INT DEFAULT 0,updated_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE product_binary_settlement_jobs(id UUID PRIMARY KEY,qualified_at TIMESTAMPTZ);
      CREATE TABLE product_binary_order_events(id UUID PRIMARY KEY,settlement_job_id UUID,processed_at TIMESTAMPTZ);
      CREATE TABLE product_binary_pair_events(id UUID PRIMARY KEY,recipient_user_id TEXT,source_leg TEXT,source_pu INT,completed_pairs INT,created_at TIMESTAMPTZ,order_event_id UUID);
      INSERT INTO users VALUES('member');
      INSERT INTO product_binary_positions(user_id,left_carryover_pu) VALUES('member',2);
    `)
    const historical = randomUUID()
    await client.query('INSERT INTO product_binary_order_events(id,processed_at) VALUES($1,$2)', [historical, '2026-01-01T00:00:00+08:00'])
    await client.query("INSERT INTO product_binary_pair_events VALUES($1,'member','left',2,0,$2,$3)", [randomUUID(), '2026-01-01T00:00:00+08:00', historical])
    const migration = readFileSync('prisma/migrations/20260930100000_product_pu_fifo_expiry/migration.sql', 'utf8').replace(/^BEGIN;/, '').replace(/COMMIT;\s*$/, '')
    await client.query(migration)
    const raw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '')
      return client.query(sql, values)
    }
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (await raw(strings, ...values)).rows,
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (await raw(strings, ...values)).rowCount,
    } as any
    const add = async (leg: 'left' | 'right', amount: number, date: string, at: string) => {
      const id = randomUUID()
      await client.query('INSERT INTO product_binary_order_events(id,processed_at) VALUES($1,$2)', [id, date])
      await addProductPuLot(tx, 'member', id, leg, amount, new Date(date), new Date(at))
      return id
    }
    const newer = await add('left', 3, '2026-12-20T00:00:00+08:00', '2026-12-20T00:00:00+08:00')
    await add('right', 2, '2026-12-20T00:00:00+08:00', '2026-12-20T00:00:00+08:00')
    await consumeProductPuFifo(tx, 'member', 2, new Date('2026-12-20T00:00:00+08:00'))
    // Settlement ordinarily writes the closing position after consuming both legs.
    await client.query("UPDATE product_binary_positions SET left_carryover_pu=3,right_carryover_pu=0 WHERE user_id='member'")
    assert.equal((await client.query('SELECT remaining_pu FROM product_binary_pu_lots WHERE order_event_id=$1', [historical])).rows[0].remaining_pu, 0)
    assert.equal((await client.query('SELECT remaining_pu FROM product_binary_pu_lots WHERE order_event_id=$1', [newer])).rows[0].remaining_pu, 3)
    await expireProductPu(tx, 'member', new Date('2027-01-01T00:00:00+08:00'))
    assert.equal((await client.query('SELECT left_carryover_pu FROM product_binary_positions')).rows[0].left_carryover_pu, 3)
    await add('left', 1, '2027-12-19T00:00:00+08:00', '2027-12-19T00:00:00+08:00')
    await expireProductPu(tx, 'member', new Date('2027-12-20T00:00:00+08:00'))
    await expireProductPu(tx, 'member', new Date('2027-12-20T00:00:00+08:00'))
    assert.equal((await client.query('SELECT left_carryover_pu FROM product_binary_positions')).rows[0].left_carryover_pu, 1)
    assert.equal((await client.query('SELECT expired_pu FROM product_binary_pu_lots WHERE order_event_id=$1', [newer])).rows[0].expired_pu, 3)
    await add('right', 4, '2026-01-01T00:00:00+08:00', '2027-12-20T00:00:00+08:00')
    assert.equal((await client.query('SELECT right_carryover_pu FROM product_binary_positions')).rows[0].right_carryover_pu, 0)
    const leap = await add('left', 1, '2028-02-29T12:00:00+08:00', '2028-02-29T12:00:00+08:00')
    assert.equal(new Date((await client.query('SELECT expires_at FROM product_binary_pu_lots WHERE order_event_id=$1', [leap])).rows[0].expires_at).toISOString(), '2029-02-28T04:00:00.000Z')
    await client.query("INSERT INTO system_settings VALUES('product_pu_expiry_months','6')")
    const custom = await add('right', 1, '2028-03-01T00:00:00+08:00', '2028-03-01T00:00:00+08:00')
    assert.equal(new Date((await client.query('SELECT expires_at FROM product_binary_pu_lots WHERE order_event_id=$1', [custom])).rows[0].expires_at).toISOString(), '2028-08-31T16:00:00.000Z')
    assert.equal(new Date((await client.query('SELECT expires_at FROM product_binary_pu_lots WHERE order_event_id=$1', [leap])).rows[0].expires_at).toISOString(), '2029-02-28T04:00:00.000Z')
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
})
