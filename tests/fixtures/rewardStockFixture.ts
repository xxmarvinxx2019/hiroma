import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Client } from 'pg'
import { createRewardClaimFixture } from './productRewardClaimFixture'

export async function createRewardStockFixture(db: Client, legacy = false) {
  const fixture = await createRewardClaimFixture(db)
  await db.query(`
    ALTER TABLE distributor_profiles ADD COLUMN id TEXT,ADD COLUMN parent_dist_id TEXT;
    UPDATE distributor_profiles SET id='profile-'||user_id;
    ALTER TABLE products ADD COLUMN regional_price NUMERIC DEFAULT 150,ADD COLUMN provincial_price NUMERIC DEFAULT 155;
    INSERT INTO users VALUES('hiroma','admin','active','Hiroma','hiroma'),('regional','regional','active','Region','region'),('provincial','provincial','active','Province','province'),('outsider','provincial','active','Unrelated Province','unrelated');
    INSERT INTO distributor_profiles(user_id,dist_level,is_active,id,parent_dist_id) VALUES
      ('regional','regional',true,'profile-regional',NULL),('provincial','provincial',true,'profile-provincial','profile-regional'),('outsider','provincial',true,'profile-outsider',NULL);
    UPDATE distributor_profiles SET parent_dist_id='profile-provincial' WHERE user_id IN ('outletA','outletB');
    INSERT INTO inventory VALUES('admin-stock','hiroma','bottle',100,0,10,now()),('region-stock','regional','bottle',10,0,10,now()),('province-stock','provincial','bottle',10,0,10,now()),('outsider-stock','outsider','bottle',10,0,10,now());
  `)
  async function release(owner: 'outletA' | 'outletB', quantity: number) {
    const proof = randomUUID(), terminal = owner === 'outletA' ? fixture.terminalA : fixture.terminalB, shift = owner === 'outletA' ? fixture.shiftA : fixture.shiftB
    await db.query("INSERT INTO product_reward_claim_proofs(id,token_hash,owner_id,actor_id,reseller_id,terminal_id,shift_id,expires_at) VALUES($1,$2,$3,$3,'member',$4,$5,now()+interval '5 minutes')", [proof, randomUUID(), owner, terminal, shift])
    return (await db.query("INSERT INTO product_reward_claims(client_request_id,proof_id,owner_id,actor_id,reseller_id,product_id,terminal_id,shift_id,quantity) VALUES($1,$2,$3,$3,'member','bottle',$4,$5,$6) RETURNING id::text", [randomUUID(), proof, owner, terminal, shift, quantity])).rows[0].id as string
  }
  if (legacy) { await release('outletA', 1); await release('outletB', 1) }
  let migration = readFileSync('prisma/migrations/20261030090000_reward_stock_replacements/migration.sql', 'utf8').replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '')
  migration = migration.replaceAll('pg_catalog,public,pg_temp', `pg_catalog,"${fixture.schema}",pg_temp`)
  await db.query(migration)
  await db.query('CREATE TABLE orders(id TEXT PRIMARY KEY,buyer_id TEXT,seller_id TEXT,status TEXT)')
  const combined = readFileSync('prisma/migrations/20261031090000_combined_order_replacements/migration.sql', 'utf8').replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '').replaceAll('pg_catalog,public,pg_temp', `pg_catalog,"${fixture.schema}",pg_temp`)
  await db.query(combined)
  await db.query(`ALTER TABLE distributor_profiles ADD COLUMN region_code TEXT,ADD COLUMN province_code TEXT,ADD COLUMN city_muni_code TEXT;
    UPDATE distributor_profiles SET region_code='R1',province_code='P1',city_muni_code='C-'||user_id;
    UPDATE distributor_profiles SET region_code='R2',province_code='P2' WHERE user_id='outsider';`)
  const territory = readFileSync('prisma/migrations/20261031110000_align_supplier_territories/migration.sql', 'utf8').replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '').replaceAll('pg_catalog,public,pg_temp', `pg_catalog,"${fixture.schema}",pg_temp`)
  await db.query(territory)
  return { ...fixture, release }
}
