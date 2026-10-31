import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Client } from 'pg'

export async function createRewardClaimFixture(db: Client) {
  const schema = `claim_test_${randomUUID().replaceAll('-', '')}`
  const terminalA = randomUUID(), terminalB = randomUUID(), shiftA = randomUUID(), shiftB = randomUUID(), reward = randomUUID(), pair = randomUUID()
  await db.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}", public`)
  await db.query(`
    CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT,full_name TEXT,username TEXT);
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,branch_price NUMERIC,city_price NUMERIC,cost_price NUMERIC);
    CREATE TABLE distributor_profiles(user_id TEXT PRIMARY KEY,dist_level TEXT,is_active BOOLEAN,fulfillment_outlet_name TEXT);
    CREATE TABLE staff_profiles(user_id TEXT,owner_id TEXT,is_active BOOLEAN,permissions JSONB);
    CREATE TABLE pos_terminals(id UUID PRIMARY KEY,owner_id TEXT,is_active BOOLEAN);
    CREATE TABLE pos_shifts(id UUID PRIMARY KEY,owner_id TEXT,terminal_id UUID,opened_by_id TEXT,status TEXT);
    CREATE TABLE inventory(id TEXT PRIMARY KEY,owner_id TEXT,product_id TEXT,quantity INT,reserved_quantity INT,low_stock_threshold INT,updated_at TIMESTAMPTZ,UNIQUE(owner_id,product_id));
    CREATE TABLE inventory_audit_events(id UUID PRIMARY KEY,owner_id TEXT,product_id TEXT,actor_id TEXT,actor_name_snapshot TEXT,event_type TEXT,quantity_delta INT,quantity_before INT,quantity_after INT,unit_cost_snapshot NUMERIC,total_value NUMERIC,reference_type TEXT,reference_id TEXT,reason TEXT,metadata JSONB,created_at TIMESTAMPTZ);
    CREATE TABLE binary_pair_events(id UUID PRIMARY KEY,opening_reward_eligible_count BIGINT,payable_pairs INT,reward_interval INT,source_kind TEXT);
    CREATE TABLE package_binary_product_rewards(id UUID PRIMARY KEY,user_id TEXT,product_id TEXT,product_name_snapshot TEXT,unit_cost_snapshot NUMERIC,quantity INT,pair_event_id UUID,created_at TIMESTAMPTZ DEFAULT now());
    CREATE FUNCTION reject_financial_history_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only history'; END $$;
    INSERT INTO users VALUES('outletA','city','active','Branch A','branch-a'),('outletB','city','active','City B','city-b'),('member','reseller','active','Member One','member'),('other','reseller','active','Other Member','other'),('staff','staff','active','Cashier','cashier');
    INSERT INTO distributor_profiles VALUES('outletA','branch',true,'Branch A'),('outletB','city',true,'City B');
    INSERT INTO staff_profiles VALUES('staff','outletA',true,'["pos"]');
    INSERT INTO products VALUES('bottle','Reward Bottle',160,163,100),('other','Other Bottle',160,163,100);
    INSERT INTO inventory VALUES('invA','outletA','bottle',20,2,10,now()),('invB','outletB','bottle',20,0,10,now());
  `)
  await db.query('INSERT INTO pos_terminals VALUES($1,\'outletA\',true),($2,\'outletB\',true)', [terminalA, terminalB])
  await db.query('INSERT INTO pos_shifts VALUES($1,\'outletA\',$2,\'outletA\',\'open\'),($3,\'outletB\',$4,\'outletB\',\'open\')', [shiftA, terminalA, shiftB, terminalB])
  await db.query("INSERT INTO binary_pair_events VALUES($1,0,15,5,'registration')", [pair])
  await db.query("INSERT INTO package_binary_product_rewards VALUES($1,'member','bottle','Reward Bottle',100,3,$2,now())", [reward, pair])
  let migration = readFileSync('prisma/migrations/20261029090000_product_reward_claims/migration.sql', 'utf8').replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '')
  migration = migration.replaceAll('pg_catalog,public,pg_temp', `pg_catalog,"${schema}",pg_temp`)
  await db.query(migration)
  return { schema, terminalA, terminalB, shiftA, shiftB, reward, pair }
}
