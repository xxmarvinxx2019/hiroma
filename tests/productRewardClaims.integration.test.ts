import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Client } from 'pg'
import type { Prisma } from '@prisma/client'
import { createRewardClaimFixture } from './fixtures/productRewardClaimFixture'
import { findRewardClaimReplay, hashRewardClaimProof, listClaimableRewardBottles } from '../src/app/lib/productRewardClaims'
import { loadProductRewardHistory } from '../src/app/lib/productRewardHistory'

const connection = () => new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
const adapter = (db: Client) => ({ $queryRaw: async (sql: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
  if ('text' in sql) return (await db.query(sql.text, [...sql.values])).rows
  const text = sql.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '')
  return (await db.query(text, values)).rows
} }) as Pick<Prisma.TransactionClient, '$queryRaw'>

test('claims atomically transfer stock, allocate milestones, preserve history and reject invalid releases', { skip: !process.env.DATABASE_URL }, async () => {
  const db = connection(); await db.connect(); await db.query('BEGIN')
  try {
    const fixture = await createRewardClaimFixture(db)
    const dbAdapter = adapter(db)
    async function proof(owner = 'outletA', actor = owner, reseller = 'member', expired = false) {
      const id = randomUUID(), token = Buffer.from(randomUUID()).toString('base64url').slice(0, 43)
      const terminal = owner === 'outletA' ? fixture.terminalA : fixture.terminalB
      const shift = owner === 'outletA' ? fixture.shiftA : fixture.shiftB
      await db.query('INSERT INTO product_reward_claim_proofs(id,token_hash,owner_id,actor_id,reseller_id,terminal_id,shift_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+$8::interval)', [id, hashRewardClaimProof(token), owner, actor, reseller, terminal, shift, expired ? '-1 minute' : '5 minutes'])
      return { id, token, owner, actor, terminal, shift, reseller }
    }
    async function claim(p: Awaited<ReturnType<typeof proof>>, quantity: number, request = randomUUID(), owner = p.owner, member = p.reseller) {
      return db.query('INSERT INTO product_reward_claims(client_request_id,proof_id,owner_id,actor_id,reseller_id,product_id,terminal_id,shift_id,quantity) VALUES($1,$2,$3,$4,$5,\'bottle\',$6,$7,$8) RETURNING *', [request, p.id, owner, p.actor, member, p.terminal, p.shift, quantity])
    }
    async function reject(action: () => Promise<unknown>, pattern: RegExp) {
      await db.query('SAVEPOINT invalid_claim')
      await assert.rejects(action, pattern)
      await db.query('ROLLBACK TO SAVEPOINT invalid_claim')
    }
    const p = await proof(), request = randomUUID()
    const first = (await claim(p, 1, request)).rows[0]
    assert.equal(first.stock_before, 20); assert.equal(first.stock_after, 19)
    assert.equal((await db.query("SELECT quantity FROM inventory WHERE owner_id='member'")).rows[0].quantity, 1)
    assert.equal((await db.query('SELECT count(*)::int n FROM inventory_audit_events')).rows[0].n, 2)
    const replay = await findRewardClaimReplay(dbAdapter, { client_request_id: request, terminal_id: p.terminal, shift_id: p.shift, reseller_id: 'member', product_id: 'bottle', quantity: 1, scan_proof: p.token }, 'outletA', 'outletA')
    assert.equal(replay?.id, first.id)
    assert.equal(replay?.available_stock, 17)
    await assert.rejects(findRewardClaimReplay(dbAdapter, { client_request_id: request, terminal_id: p.terminal, shift_id: p.shift, reseller_id: 'member', product_id: 'bottle', quantity: 2, scan_proof: p.token }, 'outletA', 'outletA'), /different release/)
    await reject(() => claim(p, 1), /Scan the reseller/)
    const secondProof = await proof('outletB')
    await claim(secondProof, 1)
    const available = await listClaimableRewardBottles(dbAdapter, 'member', 'outletA')
    assert.equal(available[0].unclaimed, 1); assert.equal(available[0].available_stock, 17)
    const history = await loadProductRewardHistory(dbAdapter, { kind: 'reseller', userId: 'member' }, { page: 1, pageSize: 20 })
    assert.equal(history.items.filter(row => row.claim_reference).length, 2)
    assert.equal(history.items.filter(row => !row.claim_reference).length, 1)
    assert.deepEqual(new Set(history.items.filter(row => row.claim_outlet).map(row => row.claim_outlet)), new Set(['Branch A', 'City B']))
    const tooMany = await proof()
    await reject(() => claim(tooMany, 2), /Not enough unclaimed/)
    assert.equal((await db.query('SELECT used_at FROM product_reward_claim_proofs WHERE id=$1', [tooMany.id])).rows[0].used_at, null)
    const expired = await proof('outletA', 'outletA', 'member', true)
    await reject(() => claim(expired, 1), /Scan the reseller/)
    const mismatch = await proof()
    await reject(() => claim(mismatch, 1, randomUUID(), 'outletB'), /Scan the reseller/)
    await reject(() => claim(mismatch, 1, randomUUID(), 'outletA', 'other'), /Scan the reseller/)
    const otherMember = await proof('outletA', 'outletA', 'other')
    await reject(() => claim(otherMember, 1), /Not enough unclaimed/)
    await db.query("UPDATE inventory SET reserved_quantity=quantity WHERE owner_id='outletA'")
    await reject(() => claim(mismatch, 1), /Not enough available outlet stock/)
    await db.query("UPDATE inventory SET reserved_quantity=2 WHERE owner_id='outletA'")
    await db.query("UPDATE pos_shifts SET status='closed' WHERE id=$1", [fixture.shiftA])
    await reject(() => claim(mismatch, 1), /Open your own cashier shift/)
    await db.query("UPDATE pos_shifts SET status='open' WHERE id=$1", [fixture.shiftA])
    const staffProof = await proof('outletA', 'staff')
    await db.query("UPDATE staff_profiles SET permissions='[]'")
    await reject(() => claim(staffProof, 1), /authorized POS cashier/)
    await reject(() => db.query('DELETE FROM product_reward_claims'), /append-only/)
    await reject(() => db.query('INSERT INTO product_reward_claim_allocations(claim_id,reward_id,unit_number) VALUES($1,$2,3)', [first.id, fixture.reward]), /protected/)
    assert.equal((await db.query('SELECT count(*)::int n FROM product_reward_claims')).rows[0].n, 2)
    assert.equal((await db.query("SELECT quantity FROM inventory WHERE owner_id='outletA'")).rows[0].quantity, 19)
    await db.query("UPDATE staff_profiles SET permissions='[\"pos\"]'")
    await db.query("UPDATE pos_shifts SET opened_by_id='staff' WHERE id=$1", [fixture.shiftA])
    const cashierProof = await proof('outletA', 'staff')
    await claim(cashierProof, 1)
    assert.equal((await db.query("SELECT quantity FROM inventory WHERE owner_id='outletA'")).rows[0].quantity, 18)
    assert.equal((await db.query("SELECT quantity FROM inventory WHERE owner_id='member'")).rows[0].quantity, 3)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('two outlets racing for the final bottle commit only one release', { skip: !process.env.DATABASE_URL }, async () => {
  const setup = connection(); await setup.connect()
  let schema = ''
  const peers: Client[] = []
  try {
    await setup.query('BEGIN')
    const fixture = await createRewardClaimFixture(setup); schema = fixture.schema
    await setup.query('UPDATE package_binary_product_rewards SET quantity=1')
    await setup.query('COMMIT')
    const attempts = await Promise.all(['outletA', 'outletB'].map(async (owner, index) => {
      const db = connection(); peers.push(db); await db.connect()
      await db.query('BEGIN')
      await db.query(`SET LOCAL search_path TO "${schema}",public`)
      const proof = randomUUID(), terminal = index ? fixture.terminalB : fixture.terminalA, shift = index ? fixture.shiftB : fixture.shiftA
      await db.query("INSERT INTO product_reward_claim_proofs(id,token_hash,owner_id,actor_id,reseller_id,terminal_id,shift_id,expires_at) VALUES($1,$2,$3,$3,'member',$4,$5,now()+interval '5 minutes')", [proof, randomUUID(), owner, terminal, shift])
      return { db, owner, proof, terminal, shift }
    }))
    const results = await Promise.all(attempts.map(async ({ db, owner, proof, terminal, shift }) => {
      try {
        await db.query("SET LOCAL lock_timeout='10s'")
        await db.query("INSERT INTO product_reward_claims(client_request_id,proof_id,owner_id,actor_id,reseller_id,product_id,terminal_id,shift_id,quantity) VALUES($1,$2,$3,$3,'member','bottle',$4,$5,1)", [randomUUID(), proof, owner, terminal, shift])
        await db.query('COMMIT'); return true
      } catch { await db.query('ROLLBACK'); return false }
    }))
    assert.equal(results.filter(Boolean).length, 1)
    await setup.query('BEGIN')
    await setup.query(`SET LOCAL search_path TO "${schema}",public`)
    assert.equal((await setup.query('SELECT count(*)::int n FROM product_reward_claim_allocations')).rows[0].n, 1)
    assert.equal((await setup.query("SELECT sum(quantity)::int n FROM inventory WHERE owner_id IN ('outletA','outletB')")).rows[0].n, 39)
    await setup.query('COMMIT')
  } finally {
    await setup.query('ROLLBACK')
    await Promise.all(peers.map(db => db.end()))
    if (schema) await setup.query(`DROP SCHEMA "${schema}" CASCADE`)
    await setup.end()
  }
})
