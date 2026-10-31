import 'dotenv/config'
import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from 'pg'
import { createRewardStockFixture } from './fixtures/rewardStockFixture'

const connect = () => new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })

test('territory fallback authorizes replacement stock without a parent link and rejects other territories', { skip: !process.env.DATABASE_URL }, async () => {
  const db = connect(); await db.connect(); await db.query('BEGIN')
  try {
    const fixture = await createRewardStockFixture(db)
    await db.query("UPDATE distributor_profiles SET parent_dist_id=NULL WHERE user_id='outletB'")
    const allowed = async (supplier: string, recipient = 'outletB', kind = 'distributor_replacement') => (await db.query('SELECT can_supply_reward_stock($1,$2,$3) allowed', [supplier, recipient, kind])).rows[0].allowed
    assert.equal(await allowed('provincial'), true)
    assert.equal(await allowed('regional'), true)
    assert.equal(await allowed('hiroma'), true)
    assert.equal(await allowed('outsider'), false)
    assert.equal(await allowed('provincial', 'outletA', 'internal_replenishment'), false)
    async function reject(sql: string, pattern: RegExp) {
      await db.query('SAVEPOINT invalid_territory'); await assert.rejects(db.query(sql), pattern); await db.query('ROLLBACK TO SAVEPOINT invalid_territory')
    }
    await reject("UPDATE distributor_profiles SET parent_dist_id='profile-outsider' WHERE user_id='outletB'", /PARENT_TERRITORY_MISMATCH/)
    await db.query("UPDATE distributor_profiles SET parent_dist_id='profile-provincial' WHERE user_id='outletB'")
    await reject("UPDATE distributor_profiles SET province_code='P3' WHERE user_id='provincial'", /CHILD_TERRITORY_MISMATCH/)
    await reject("UPDATE distributor_profiles SET region_code='R2' WHERE user_id='outletB'", /PARENT_TERRITORY_MISMATCH/)
    await reject("UPDATE distributor_profiles SET parent_dist_id='profile-provincial' WHERE user_id='regional'", /PARENT_TERRITORY_MISMATCH/)
    await reject("UPDATE distributor_profiles SET city_muni_code='C-outletA' WHERE user_id='outletB'", /distributor_active_city_branch_unique/)
    await reject("UPDATE distributor_profiles SET region_code=NULL WHERE user_id='outletB'", /TERRITORY_REQUIRED/)
    await db.query("UPDATE users SET status='inactive' WHERE id='provincial'")
    assert.equal(await allowed('provincial'), false)
    assert.equal(await allowed('regional'), true)
    await db.query("UPDATE users SET status='inactive' WHERE id='regional'")
    assert.equal(await allowed('regional'), false)
    assert.equal(await allowed('hiroma'), true)
    // Prove the same fallback can actually reserve and fulfill the original credits.
    await fixture.release('outletB', 1)
    await db.query("INSERT INTO orders VALUES('direct','outletB','hiroma','pending')")
    await db.query("INSERT INTO order_replacement_requests(order_id,actor_id,product_id,kind,quantity) VALUES('direct','outletB','bottle','distributor_replacement',1)")
    await db.query("UPDATE orders SET status='delivered' WHERE id='direct'")
    const dispatch = (await db.query("SELECT id FROM order_replacement_requests WHERE order_id='direct'")).rows[0].id
    await db.query("INSERT INTO reward_stock_receipts(dispatch_id,actor_id) VALUES($1,'outletB')", [dispatch])
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM reward_stock_units WHERE settled_at IS NOT NULL')).rows[0].n, 1)
  } finally { await db.query('ROLLBACK'); await db.end() }
})

test('simultaneous territory activations commit at most one distributor', { skip: !process.env.DATABASE_URL }, async () => {
  const db = connect(); await db.connect(); const peers: Client[] = []; let schema = ''
  try {
    await db.query('BEGIN'); const f = await createRewardStockFixture(db); schema = f.schema
    await db.query("INSERT INTO users VALUES('new1','city','active','New One','new1'),('new2','city','active','New Two','new2')")
    await db.query("INSERT INTO distributor_profiles(user_id,id,dist_level,is_active,region_code,province_code,city_muni_code) VALUES('new1','new-profile-1','city',false,'R1','P1','C-new'),('new2','new-profile-2','city',false,'R1','P1','C-new')")
    await db.query('COMMIT')
    const outcomes = await Promise.all(['new1', 'new2'].map(async id => {
      const peer = connect(); peers.push(peer); await peer.connect(); await peer.query('BEGIN'); await peer.query(`SET LOCAL search_path TO "${schema}",public`)
      try { await peer.query('UPDATE distributor_profiles SET is_active=true WHERE user_id=$1', [id]); await peer.query('COMMIT'); return true }
      catch { await peer.query('ROLLBACK'); return false }
    }))
    assert.equal(outcomes.filter(Boolean).length, 1)
    assert.equal((await db.query(`SELECT COUNT(*)::int n FROM "${schema}".distributor_profiles WHERE is_active AND city_muni_code='C-new'`)).rows[0].n, 1)
  } finally { await Promise.all(peers.map(peer => peer.end())); if (schema) await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.end() }
})
