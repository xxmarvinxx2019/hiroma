import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import type { Client } from 'pg'

export function capFixtureSql(sql: string, schema: string) {
  return sql.replace(/\bBEGIN;\s*\n/, '').replace(/COMMIT;\s*$/, '')
    .replaceAll('pg_catalog, public, pg_temp', `pg_catalog,"${schema}",pg_temp`)
    .replaceAll('pg_catalog,public,pg_temp', `pg_catalog,"${schema}",pg_temp`)
    .replaceAll('public.', `"${schema}".`).replaceAll('CURRENT_TIMESTAMP', 'cap_test_now()')
}
export async function installCapHardening(db: Client, schema: string) {
  await db.query(capFixtureSql(readFileSync('prisma/migrations/20261031150000_harden_package_binary_daily_caps/migration.sql', 'utf8'), schema))
}
export async function createPackageCapFixture(db: Client, options: { cap?: number; used?: number; day?: string; harden?: boolean; sessions?: boolean } = {}) {
  const schema = `daily_cap_test_${randomUUID().replaceAll('-', '')}`
  await db.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`)
  const prisma = readFileSync('prisma/schema.prisma', 'utf8')
  for (const name of ['CommissionType', 'Role']) {
    const definition = prisma.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`))
    assert.ok(definition)
    const values = definition[1].split('\n').map(x => x.trim()).filter(x => /^[A-Za-z][A-Za-z0-9_]*$/.test(x))
    await db.query(`CREATE TYPE "${name}" AS ENUM (${values.map(x => `'${x}'`).join(',')})`)
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
  await db.query(`CREATE FUNCTION cap_test_now() RETURNS TIMESTAMPTZ LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('test.cap_clock',true),''),now()::text)::timestamptz $$`)
  await db.query(capFixtureSql(readFileSync('prisma/migrations/20261028090000_package_binary_product_rewards/migration.sql', 'utf8'), schema))
  const foundation = readFileSync('prisma/migrations/20260902143000_enforce_exact_commission_entitlement/migration.sql', 'utf8')
  const closingStart = foundation.indexOf('CREATE OR REPLACE FUNCTION "validate_binary_pair_event_closing_state"()')
  await db.query(foundation.slice(closingStart, foundation.indexOf('-- A valid row is not enough', closingStart)))
  await db.query(`CREATE TRIGGER cap_test_entitlement BEFORE INSERT ON binary_pair_events FOR EACH ROW EXECUTE FUNCTION validate_binary_pair_event_entitlement();
    CREATE CONSTRAINT TRIGGER cap_test_commission AFTER INSERT ON commissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_exact_commission_entitlement();
    INSERT INTO users(id,status,username,role,full_name) VALUES('hiroma','active','hiroma','admin','Hiroma');
    INSERT INTO system_settings VALUES('package_binary_product_reward','{"enabled":true,"interval":5,"product_id":"bottle"}')`)
  await db.query('UPDATE packages SET daily_binary_pair_cap=$1', [options.cap ?? 10])
  await db.query("UPDATE reseller_profiles SET left_points=0,right_points=600000,daily_pairing_count=$1,daily_pairing_date=$2::date", [options.used ?? 0, options.day ?? null])
  if (options.harden !== false) await installCapHardening(db, schema)
  if (options.sessions) await db.query(`CREATE TABLE audit_logs(id TEXT,user_name TEXT,user_role TEXT,activity_type TEXT,category TEXT,description TEXT,metadata JSONB,risk_level TEXT,status TEXT); INSERT INTO packages VALUES('silver','Silver',1000,true,15),('gold','Gold',2000,true,50)`)
  if (options.sessions) {
    await db.query('ALTER TABLE system_settings ADD COLUMN id UUID DEFAULT gen_random_uuid(), ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now()')
    await db.query(capFixtureSql(readFileSync('prisma/migrations/20260924150000_add_binary_point_expiry_ledger/migration.sql', 'utf8'),schema))
  }
  if (options.sessions) await db.query(capFixtureSql(readFileSync('prisma/migrations/20261101090000_package_binary_two_sessions/migration.sql', 'utf8'), schema))
  else await db.query('ALTER TABLE binary_pair_events ADD COLUMN cap_session SMALLINT')
  return schema
}
