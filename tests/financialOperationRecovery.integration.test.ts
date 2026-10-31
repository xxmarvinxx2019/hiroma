import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Client } from 'pg'
import { Prisma } from '@prisma/client'
import { operationIdentity, lockFinancialOperation, replayFinancialOperation, readOperationReceipt, recordFinancialOperation } from '../src/app/lib/financialOperationRecovery'

process.env.FINANCIAL_OPERATION_HASH_SECRET ||= 'test-only-recovery-fingerprint-secret-00000000'

const connect = () => new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
function adapter(db: Client) {
  const query = (strings: TemplateStringsArray, values: unknown[]) => { const sql = Prisma.sql(strings, ...values); return db.query(sql.text, [...sql.values]) }
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (await query(strings, values)).rows,
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (await query(strings, values)).rowCount,
  } as unknown as Prisma.TransactionClient
}
test('operation fingerprint ignores object key ordering but binds every submitted detail', () => {
  const identity = (body: unknown) => operationIdentity('registration', 'pin', 'owner', 'owner', body)
  assert.equal(identity({ a: 1, b: { c: 2 } }).requestHash, identity({ b: { c: 2 }, a: 1 }).requestHash)
  assert.notEqual(identity({ a: 1 }).requestHash, identity({ a: 2 }).requestHash)
})

test('connection loss, rollback, lost response and simultaneous retries never repeat a committed operation', { skip: !process.env.DATABASE_URL }, async () => {
  const setup = connect(); await setup.connect()
  const schema = `operation_test_${randomUUID().replaceAll('-', '')}`
  const peers: Client[] = []
  try {
    await setup.query('BEGIN'); await setup.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}",public`)
    await setup.query(`CREATE TABLE users(id TEXT PRIMARY KEY,status TEXT); INSERT INTO users VALUES('owner','active'),('other','active'),('staff','active');
      CREATE TABLE staff_profiles(user_id TEXT,owner_id TEXT,is_active BOOLEAN,permissions JSONB);
      CREATE TABLE pins(id TEXT PRIMARY KEY); INSERT INTO pins VALUES('pin'),('upgrade'),('disconnect');
      CREATE TABLE registration_financials(pin_id TEXT UNIQUE,city_dist_id TEXT,reseller_id TEXT);
      CREATE TABLE upgrade_financials(upgrade_pin_id TEXT UNIQUE,city_dist_id TEXT,reseller_id TEXT);
      CREATE TABLE effects(source_id TEXT PRIMARY KEY);
      CREATE FUNCTION reject_financial_history_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only'; END $$;`)
    const migration = readFileSync('prisma/migrations/20261031130000_financial_operation_recovery/migration.sql', 'utf8').replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '').replaceAll('pg_catalog,public,pg_temp', `pg_catalog,"${schema}",pg_temp`)
    await setup.query(migration); await setup.query('COMMIT')
    const identity = operationIdentity('registration', 'pin', 'owner', 'owner', { pin_id: 'pin', password: 'not-stored', mobile: 'original' })
    async function begin() { const db = connect(); peers.push(db); await db.connect(); await db.query('BEGIN'); await db.query(`SET LOCAL search_path TO "${schema}",public`); return db }
    async function attempt(failBeforeCommit = false) {
      const db = await begin(), tx = adapter(db)
      try {
        await lockFinancialOperation(tx, identity)
        const prior = await replayFinancialOperation(tx, identity)
        if (prior) { await db.query('COMMIT'); return prior }
        await db.query("INSERT INTO effects VALUES('pin'); INSERT INTO registration_financials VALUES('pin','owner','member')")
        const result = await recordFinancialOperation(tx, identity, { success: true, reseller: { id: 'member', username: 'member' } })
        if (failBeforeCommit) throw new Error('simulated crash before commit')
        await db.query('COMMIT'); return result
      } catch (error) { await db.query('ROLLBACK'); throw error }
    }
    await assert.rejects(attempt(true), /crash before commit/)
    assert.equal((await setup.query(`SELECT COUNT(*)::int n FROM "${schema}".effects`)).rows[0].n, 0)
    // Close an actual connection with uncommitted effects and receipt.
    const interrupted = await begin(), interruptedTx = adapter(interrupted)
    const disconnectedIdentity = { ...identity, sourceId: 'disconnect' }
    await lockFinancialOperation(interruptedTx, disconnectedIdentity)
    await interrupted.query("INSERT INTO effects VALUES('disconnect'); INSERT INTO registration_financials VALUES('disconnect','owner','member')")
    await recordFinancialOperation(interruptedTx, disconnectedIdentity, { success: true, reseller: { id: 'member' } })
    await interrupted.end(); peers.splice(peers.indexOf(interrupted), 1)
    assert.equal((await setup.query(`SELECT COUNT(*)::int n FROM "${schema}".effects`)).rows[0].n, 0)
    // Ignore the first successful response, then retry from independent connections.
    const concurrent = await Promise.all([attempt(), attempt()])
    const original = concurrent[0]
    assert.equal(concurrent[1].operation_reference, original.operation_reference)
    const results = await Promise.all([attempt(), attempt()])
    assert.ok(results.every(result => result.operation_reference === original.operation_reference))
    assert.equal((await setup.query(`SELECT COUNT(*)::int n FROM "${schema}".effects`)).rows[0].n, 1)
    assert.equal((await setup.query(`SELECT COUNT(*)::int n FROM "${schema}".financial_operation_receipts`)).rows[0].n, 1)
    const check = await begin(), tx = adapter(check)
    await assert.rejects(replayFinancialOperation(tx, { ...identity, requestHash: '0'.repeat(64) }), /different details/)
    await assert.rejects(readOperationReceipt(tx, { ...identity, ownerId: 'other', actorId: 'other' }), /not available/)
    await assert.rejects(readOperationReceipt(tx, { ...identity, actorId: 'staff' }), /not available/)
    assert.equal((await readOperationReceipt(tx, identity))?.response.operation_reference, original.operation_reference)
    await check.query('SAVEPOINT tamper')
    await assert.rejects(check.query('DELETE FROM financial_operation_receipts'), /append-only/)
    await check.query('ROLLBACK TO SAVEPOINT tamper')
    await check.query('SAVEPOINT forged_receipt')
    await assert.rejects(recordFinancialOperation(tx, disconnectedIdentity, { success: true, reseller: { id: 'member' } }), /completed financial source/)
    await check.query('ROLLBACK TO SAVEPOINT forged_receipt')
    // Upgrade uses its own completed financial source and the same replay boundary.
    const upgrade = operationIdentity('upgrade', 'upgrade', 'owner', 'owner', { reseller_id: 'member', new_pin_id: 'upgrade', target_package_id: 'gold' })
    await check.query("INSERT INTO upgrade_financials VALUES('upgrade','owner','member')")
    await recordFinancialOperation(tx, upgrade, { success: true, reseller: { id: 'member' } })
    assert.ok(await replayFinancialOperation(tx, upgrade))
    await check.query('ROLLBACK')
  } finally { await Promise.all(peers.map(peer => peer.end())); await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await setup.end() }
})
