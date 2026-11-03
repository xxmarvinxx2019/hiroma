import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Client } from 'pg'

const connect = () => new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
test('lifetime person cap enforces all statuses, different IDs, concurrent branches and immutable identities', { skip: !process.env.DATABASE_URL }, async () => {
 const schema = `person_limit_test_${randomUUID().replaceAll('-', '')}`
 const db = connect(); await db.connect()
 const clients: Client[] = []
 try {
  await db.query(`BEGIN; CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}";
   CREATE TABLE users(id TEXT PRIMARY KEY, full_name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, birthday DATE, identity_document_hash TEXT);
   CREATE TABLE identity_account_limits(identity_hash TEXT PRIMARY KEY,count INT NOT NULL,max_allowed INT NOT NULL,updated_at TIMESTAMPTZ DEFAULT now(),CHECK(count>=0 AND count<=max_allowed));`)
  const migration = readFileSync('prisma/migrations/20261103090000_lifetime_person_account_limit/migration.sql','utf8')
   .replace(/^\uFEFF?BEGIN;/,'').replace(/COMMIT;\s*$/,'').replaceAll('pg_catalog,public,pg_temp',`pg_catalog,"${schema}",pg_temp`)
  await db.query(migration); await db.query('COMMIT')
  const results = await Promise.all(Array.from({length:20}, async (_, i) => {
   const c = connect(); clients.push(c); await c.connect()
   await c.query(`BEGIN; SET LOCAL search_path TO "${schema}"`)
   try {
    await c.query('INSERT INTO users VALUES($1,$2,$3,$4,$5,$6)', [`u${i}`,i%2?'  Juan   Santos Cruz ':'Juan Santos Cruz','reseller',['active','inactive','suspended'][i%3],'1990-01-01',`different-id-${i}`])
    await c.query('COMMIT'); return true
   } catch (e) { await c.query('ROLLBACK'); assert.match(String(e),/Maximum accounts \(7\)/); return false }
  }))
  const q = async (sql: string, values?: unknown[]) => {
   await db.query(`BEGIN; SET LOCAL search_path TO "${schema}"`)
   try { const result=await db.query(sql,values); await db.query('COMMIT'); return result }
   catch(e) { await db.query('ROLLBACK'); throw e }
  }
  assert.equal(results.filter(Boolean).length,7)
  assert.equal((await q('SELECT account_count FROM person_account_totals')).rows[0].account_count,7)
  const first = (await q('SELECT * FROM users LIMIT 1')).rows[0]
  await q("UPDATE users SET status='inactive' WHERE id=$1",[first.id])
  await assert.rejects(q("INSERT INTO users VALUES('eighth','Juan Santos Cruz','reseller','active','1990-01-01','new-id')"),/Maximum accounts \(7\)/)
  await assert.rejects(q("UPDATE users SET full_name='Changed Identity' WHERE id=$1",[first.id]),/cannot be reassigned/)
  await assert.rejects(q('DELETE FROM users WHERE id=$1',[first.id]),/foreign key/)
  await assert.rejects(q('UPDATE person_account_totals SET account_count=1'),/cannot be edited/)
  await assert.rejects(q('TRUNCATE person_account_documents'),/cannot be edited/)
  await q("INSERT INTO users VALUES('other','Juan Different Cruz','reseller','active','1990-01-01','other-id')")
  await assert.rejects(q("INSERT INTO users VALUES('forged','Other Name','reseller','active','1992-01-01',$1)",[first.identity_document_hash]),/ID belongs/)
  await db.query(`BEGIN; SET LOCAL search_path TO "${schema}"`)
  await db.query("INSERT INTO users VALUES('rollback','Rollback Person','reseller','active','1993-01-01','rollback-id')")
  await db.query('SET CONSTRAINTS ALL IMMEDIATE'); await db.query('ROLLBACK')
  assert.equal((await q("SELECT COUNT(*)::int n FROM person_account_documents WHERE document_hash='rollback-id'")).rows[0].n,0)
  // Registration creates the row before writing birthday/ID in the same transaction.
  await db.query(`BEGIN; SET LOCAL search_path TO "${schema}"`)
  await db.query("INSERT INTO users VALUES('staged','Staged Person','reseller','active',NULL,NULL)")
  await db.query("UPDATE users SET birthday='1995-01-01',identity_document_hash='staged-id' WHERE id='staged'")
  await db.query('COMMIT')
  assert.equal((await q("SELECT COUNT(*)::int n FROM person_account_memberships WHERE user_id='staged'")).rows[0].n,1)
 } finally {
  await Promise.all(clients.map(c=>c.end()))
  await db.query('ROLLBACK')
  await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end()
 }
})

test('migration counts inactive legacy accounts and rejects an eighth historical account atomically', {skip: !process.env.DATABASE_URL}, async () => {
 const db=connect(); await db.connect()
 const schema=`person_backfill_test_${randomUUID().replaceAll('-','')}`
 try {
  await db.query(`BEGIN; CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}";
   CREATE TABLE users(id TEXT PRIMARY KEY,full_name TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,birthday DATE,identity_document_hash TEXT);
   CREATE TABLE identity_account_limits(identity_hash TEXT PRIMARY KEY,count INT NOT NULL,max_allowed INT NOT NULL,updated_at TIMESTAMPTZ DEFAULT now(),CHECK(count>=0 AND count<=max_allowed));
   INSERT INTO users SELECT n::text,'Legacy Middle Person','reseller','inactive','1980-01-01'::date,'same-legacy-id' FROM generate_series(1,8) n;`)
  const sql=readFileSync('prisma/migrations/20261103090000_lifetime_person_account_limit/migration.sql','utf8')
   .replace(/^\uFEFF?BEGIN;/,'').replace(/COMMIT;\s*$/,'').replaceAll('pg_catalog,public,pg_temp',`pg_catalog,"${schema}",pg_temp`)
  await db.query('SAVEPOINT migration_attempt')
  await assert.rejects(db.query(sql),/Maximum accounts \(7\)/)
  await db.query('ROLLBACK TO SAVEPOINT migration_attempt')
  await db.query("DELETE FROM users WHERE id='8'")
  await db.query(sql)
  assert.equal((await db.query('SELECT account_count FROM person_account_totals')).rows[0].account_count,7)
  assert.equal((await db.query('SELECT count,max_allowed FROM identity_account_limits')).rows[0].count,7)
  await assert.rejects(db.query('UPDATE identity_account_limits SET max_allowed=8'),/check constraint/)
 } finally { await db.query('ROLLBACK'); await db.end() }
})
