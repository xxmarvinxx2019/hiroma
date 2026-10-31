import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Client } from 'pg'
import type { Prisma } from '@prisma/client'
import { loadProductRewardHistory } from '../src/app/lib/productRewardHistory'

// Execute the real migration and entitlement triggers in a disposable schema.
// The outer transaction always rolls back, including schema creation.
test('database seals cash/product split, history, caps, policy changes and duplicate credits', { skip: !process.env.DATABASE_URL }, async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
  await db.connect()
  try {
    await db.query('BEGIN')
    await db.query("SET LOCAL statement_timeout='15s'")
    const schema = `reward_test_${randomUUID().replaceAll('-', '')}`
    await db.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`)
    // A clean CI database has no application types/functions in public. Keep
    // all prerequisites local to the disposable fixture, including on dev DBs.
    const prismaSchema = readFileSync('prisma/schema.prisma', 'utf8')
    for (const name of ['CommissionType', 'Role']) {
      const definition = prismaSchema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`))
      assert.ok(definition, `Missing ${name} enum in Prisma schema`)
      const values = definition[1].split('\n').map(line => line.trim()).filter(line => /^[A-Za-z][A-Za-z0-9_]*$/.test(line))
      assert.ok(values.length > 0)
      await db.query(`CREATE TYPE "${name}" AS ENUM (${values.map(value => `'${value}'`).join(',')})`)
    }
    await db.query(`
      CREATE FUNCTION reject_financial_history_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Financial history is append-only.'; END $$;
      CREATE TABLE users(id TEXT PRIMARY KEY,status TEXT,username TEXT,role "Role");
      CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,cost_price NUMERIC,is_active BOOLEAN);
      CREATE TABLE packages(id TEXT PRIMARY KEY,name TEXT,pairing_bonus_value NUMERIC,binary_pair_cap_enabled BOOLEAN,daily_binary_pair_cap INTEGER);
      CREATE TABLE reseller_profiles(user_id TEXT PRIMARY KEY,package_id TEXT,left_points INTEGER,right_points INTEGER,daily_pairing_count INTEGER,daily_pairing_date DATE);
      CREATE TABLE binary_tree_nodes(id TEXT PRIMARY KEY,user_id TEXT,parent_id TEXT,position TEXT,sponsor_id TEXT);
      CREATE TABLE binary_settlement_events(source_kind TEXT,source_event_id TEXT,source_user_id TEXT,source_points INTEGER,parent_node_id TEXT,source_leg TEXT);
      CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE commissions(id TEXT PRIMARY KEY,type "CommissionType",rule_version TEXT,is_pair_overflow BOOLEAN,user_id TEXT,source_user_id TEXT,source_event_kind TEXT,source_event_id TEXT,amount NUMERIC,points NUMERIC,overflow_to TEXT);
      CREATE TABLE binary_pair_events(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),recipient_user_id TEXT,source_user_id TEXT,source_kind TEXT,source_event_id TEXT,source_leg TEXT,source_points INTEGER,
        recipient_package_id TEXT,package_name_snapshot TEXT,pair_value_snapshot NUMERIC,package_snapshot_source TEXT,
        points_per_pair INTEGER,peso_per_point NUMERIC,opening_left_points INTEGER,opening_right_points INTEGER,closing_left_points INTEGER,closing_right_points INTEGER,
        pairing_day DATE,opening_daily_pairing_count INTEGER,closing_daily_pairing_count INTEGER,
        completed_pairs INTEGER,payable_pairs INTEGER,cap_flashout_pairs INTEGER,inactive_flashout_pairs INTEGER,
        consumed_left_points INTEGER,consumed_right_points INTEGER,payable_amount NUMERIC,flashout_amount NUMERIC,
        cap_enabled BOOLEAN,cap_limit INTEGER,normal_commission_id TEXT,flashout_commission_id TEXT,created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(source_kind,source_event_id,recipient_user_id),
        CHECK(completed_pairs=payable_pairs+cap_flashout_pairs+inactive_flashout_pairs));
      INSERT INTO users VALUES('member','active','member','reseller'),('buyer','active','buyer','reseller');
      INSERT INTO products VALUES('bottle','Reward Bottle',100,true),('other','Other Bottle',120,true);
      INSERT INTO packages VALUES('package','Starter',600,true,10);
      INSERT INTO reseller_profiles VALUES('member','package',0,0,0,NULL);
      INSERT INTO binary_tree_nodes VALUES('root','member',NULL,NULL,NULL),('child','buyer','root','left','member');
      ALTER TABLE users ADD COLUMN full_name TEXT;
      UPDATE users SET full_name=CASE WHEN id='member' THEN 'Member One' ELSE 'Buyer Two' END;
    `)
    let migration = readFileSync('prisma/migrations/20261028090000_package_binary_product_rewards/migration.sql', 'utf8')
      .replace(/\bBEGIN;\s*\n/, '').replace(/COMMIT;\s*$/, '')
    // The production definer function pins public. Pin the disposable schema instead.
    migration = migration.replaceAll('pg_catalog, public, pg_temp', `pg_catalog, "${schema}", pg_temp`).replaceAll('public.', `"${schema}".`)
    await db.query(migration)
    await db.query(`CREATE TABLE product_reward_claims(id UUID PRIMARY KEY,released_at TIMESTAMPTZ,outlet_name_snapshot TEXT,actor_name_snapshot TEXT);
      CREATE TABLE product_reward_claim_allocations(claim_id UUID,reward_id UUID,unit_number INTEGER);`)
    await db.query(`CREATE TRIGGER test_pair_entitlement BEFORE INSERT ON binary_pair_events FOR EACH ROW EXECUTE FUNCTION validate_binary_pair_event_entitlement();
      CREATE CONSTRAINT TRIGGER test_commission_entitlement AFTER INSERT ON commissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_exact_commission_entitlement();`)

    async function configure(interval: number, enabled = true, product = 'bottle') {
      await db.query(`INSERT INTO system_settings VALUES('package_binary_product_reward',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ interval, enabled, product_id: product })])
    }
    async function rejected(action: () => Promise<unknown>, pattern: RegExp) {
      await db.query('SAVEPOINT expected_failure')
      await assert.rejects(action, pattern)
      await db.query('ROLLBACK TO SAVEPOINT expected_failure')
    }
    let opening = 0
    async function pair(completed: number, eligible: number, products: number, interval: number | null, overrides: Record<string, unknown> = {}) {
      const source = randomUUID(), commission = eligible > products ? randomUUID() : null
      const flashout = completed - eligible > 0 ? randomUUID() : null
      const active = (await db.query("SELECT status FROM users WHERE id='member'")).rows[0].status === 'active'
      await db.query(`UPDATE reseller_profiles SET left_points=0,right_points=$1,daily_pairing_count=$2,daily_pairing_date=(now() AT TIME ZONE 'Asia/Manila')::date WHERE user_id='member'`, [completed * 600, active ? 10 - eligible : 0])
      await db.query(`INSERT INTO binary_settlement_events VALUES('registration',$1,'buyer',$2,'root','left')`, [source, completed * 600])
      if (commission) await db.query(`INSERT INTO commissions VALUES($1,'binary_pairing','package-binary-v1',false,'member','buyer','registration',$2,$3,$4,NULL)`, [commission, source, (eligible - products) * 300, (eligible - products) * 600])
      const event: Record<string, unknown> = { recipient_user_id: 'member', source_user_id: 'buyer', source_kind: 'registration', source_event_id: source, source_leg: 'left', source_points: completed * 600,
        recipient_package_id: 'package', package_name_snapshot: 'Starter', pair_value_snapshot: 300, package_snapshot_source: 'exact_event',
        points_per_pair: 600, peso_per_point: 0.5, opening_left_points: 0, opening_right_points: completed * 600, closing_left_points: 0, closing_right_points: 0,
        completed_pairs: completed, payable_pairs: eligible, product_reward_pairs: products, reward_interval: interval,
        reward_product_id: interval ? 'bottle' : null, opening_reward_eligible_count: opening,
        cap_flashout_pairs: active ? completed - eligible : 0, inactive_flashout_pairs: active ? 0 : completed,
        consumed_left_points: completed * 600, consumed_right_points: completed * 600, payable_amount: (eligible - products) * 300, flashout_amount: (completed - eligible) * 300,
        cap_enabled: true, cap_limit: 10, normal_commission_id: commission, flashout_commission_id: flashout, ...overrides }
      const keys = Object.keys(event)
      const result = await db.query(`INSERT INTO binary_pair_events(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, Object.values(event))
      // Force the actual deferred cash entitlement check to execute now.
      if (active && completed === eligible) {
        await db.query('SET CONSTRAINTS test_commission_entitlement IMMEDIATE')
        await db.query('SET CONSTRAINTS test_commission_entitlement DEFERRED')
      }
      if (interval) opening += eligible
      return result.rows[0].id
    }

    // Existing history is excluded; disabled pairs remain fully cash.
    await pair(4, 4, 0, null)
    await configure(5)
    await pair(4, 4, 0, 5)
    const fifth = await pair(1, 1, 1, 5)
    assert.equal((await db.query('SELECT SUM(quantity)::int bottles FROM package_binary_product_rewards')).rows[0].bottles, 1)
    assert.equal((await db.query('SELECT SUM(amount)::int amount FROM commissions')).rows[0].amount, 2400)
    // Immutable snapshot remains at company cost even after product price edits.
    await db.query("UPDATE products SET cost_price=110 WHERE id='bottle'")
    assert.equal(Number((await db.query('SELECT unit_cost_snapshot FROM package_binary_product_rewards')).rows[0].unit_cost_snapshot), 100)
    await rejected(() => db.query(`INSERT INTO package_binary_product_rewards(pair_event_id,user_id,product_id,product_name_snapshot,unit_cost_snapshot,quantity) VALUES($1,'member','bottle','Reward Bottle',110,1)`, [fifth]), /exact Package Binary entitlement/)
    await rejected(() => db.query('DELETE FROM package_binary_product_rewards'), /append-only/)
    await configure(6)
    await pair(1, 1, 1, 6)
    // Changing product also preserves earned SKU snapshots.
    await configure(5)
    await pair(10, 10, 2, 5)
    assert.equal((await db.query('SELECT SUM(quantity)::int bottles FROM package_binary_product_rewards')).rows[0].bottles, 4)
    const historyDb = {
      $queryRaw: async (query: Prisma.Sql) => (await db.query(query.text, [...query.values])).rows,
    } as Pick<Prisma.TransactionClient, '$queryRaw'>
    const adminHistory = await loadProductRewardHistory(historyDb, { kind: 'admin', search: '' }, { page: 1, pageSize: 50 })
    assert.equal(adminHistory.total, 4)
    assert.deepEqual(adminHistory.items.map(row => row.qualifying_pair).sort((a, b) => a - b), [5, 6, 10, 15])
    assert.equal(new Set(adminHistory.items.map(row => row.reference)).size, 4)
    assert.ok(adminHistory.items.every(row => row.quantity === 1 && row.member_name === 'Member One' && row.member_username === 'member'))
    assert.equal(adminHistory.items.find(row => row.qualifying_pair === 5)?.company_unit_cost, 100)
    assert.equal(adminHistory.items.find(row => row.qualifying_pair === 6)?.reward_interval, 6)
    const batch = adminHistory.items.filter(row => row.qualifying_pair === 10 || row.qualifying_pair === 15)
    assert.equal(batch[0].transaction_reference, batch[1].transaction_reference)
    assert.notEqual(batch[0].reference, batch[1].reference)
    const resellerHistory = await loadProductRewardHistory(historyDb, { kind: 'reseller', userId: 'member' }, { page: 1, pageSize: 50 })
    assert.deepEqual(resellerHistory.items.map(row => row.reference), adminHistory.items.map(row => row.reference))
    assert.ok(resellerHistory.items.every(row => !('company_unit_cost' in row) && !('member_username' in row) && !('member_name' in row)))
    const otherHistory = await loadProductRewardHistory(historyDb, { kind: 'reseller', userId: 'buyer' }, { page: 1, pageSize: 20 })
    assert.equal(otherHistory.total, 0)
    assert.deepEqual(otherHistory.items, [])
    const exact = await loadProductRewardHistory(historyDb, { kind: 'admin', search: batch[0].reference }, { page: 1, pageSize: 20 })
    assert.equal(exact.total, 1)
    assert.equal(exact.items[0].reference, batch[0].reference)
    const nameSearch = await loadProductRewardHistory(historyDb, { kind: 'admin', search: 'Member One' }, { page: 1, pageSize: 20 })
    assert.equal(nameSearch.total, 4)
    const wildcard = await loadProductRewardHistory(historyDb, { kind: 'admin', search: '%' }, { page: 1, pageSize: 20 })
    assert.equal(wildcard.total, 0)
    const pageOne = await loadProductRewardHistory(historyDb, { kind: 'reseller', userId: 'member' }, { page: 1, pageSize: 2 })
    const pageTwo = await loadProductRewardHistory(historyDb, { kind: 'reseller', userId: 'member' }, { page: 2, pageSize: 2 })
    assert.equal(pageOne.total_pages, 2)
    assert.equal(new Set([...pageOne.items, ...pageTwo.items].map(row => row.reference)).size, 4)
    // Reading either history must never mint credits or change quantities.
    assert.equal((await db.query('SELECT SUM(quantity)::int bottles FROM package_binary_product_rewards')).rows[0].bottles, 4)
    await rejected(() => pair(1, 1, 1, 5), /does not match locked policy/)
    await rejected(() => pair(1, 1, 0, 5, { opening_reward_eligible_count: 0 }), /does not match locked policy/)
    await rejected(() => pair(1, 1, 0, 5, { reward_product_id: 'other' }), /does not match locked policy/)
    const before = opening
    await pair(3, 0, 0, 5) // Daily cap exhausted: no progress or bottle.
    assert.equal(opening, before)
    await db.query("UPDATE users SET status='inactive' WHERE id='member'")
    await pair(2, 0, 0, 5)
    assert.equal(opening, before)
    await db.query("UPDATE users SET status='active' WHERE id='member'")
    await configure(5, false)
    await pair(3, 3, 0, null)
    assert.equal(opening, before)
    await configure(5)
    await db.query("UPDATE products SET is_active=false WHERE id='bottle'")
    await rejected(() => pair(1, 1, 0, 5), /active reward bottle/)
  } finally {
    await db.query('ROLLBACK')
    await db.end()
  }
})
