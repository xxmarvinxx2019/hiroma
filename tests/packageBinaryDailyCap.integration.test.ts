import 'dotenv/config'
import { createBinaryPointLot, consumeBinaryPointLots } from '../src/app/lib/binaryPointExpiry'
import { planPackageBinaryCarryover } from '../src/app/lib/packageBinarySession'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Client } from 'pg'
import { Prisma } from '@prisma/client'
import { createPackageCapFixture, installCapHardening } from './fixtures/packageBinaryCapFixture'
import { loadPackageBinaryDailyCaps, applyPackageBinaryCapCache } from '../src/app/lib/packageBinaryDailyCap'

const clock = '2026-11-01T12:00:00+08:00'
const connect = () => new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
function adapter(db: Client) {
  function query(strings: TemplateStringsArray, values: unknown[]) {
    const sql = Prisma.sql(strings, ...values)
    return db.query(sql.text.replaceAll('CURRENT_TIMESTAMP', 'cap_test_now()'), [...sql.values])
  }
  async function insert(table: string, data: Record<string, unknown>) {
    const keys=Object.keys(data)
    return (await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,Object.values(data))).rows[0]
  }
  return {
    binaryPointLot: { create: ({data}: {data: Record<string,unknown>}) => insert('binary_point_lots',data),
      updateMany: async ({where,data}: {where:{id:string;remaining_points:number};data:{remaining_points:{decrement:number}}}) => {
        const result=await db.query('UPDATE binary_point_lots SET remaining_points=remaining_points-$1 WHERE id=$2 AND remaining_points=$3',[data.remaining_points.decrement,where.id,where.remaining_points])
        return {count:result.rowCount}
      } },
    binaryPointConsumption: {create: ({data}: {data:Record<string,unknown>}) => insert('binary_point_consumptions',data)},
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (await query(strings, values)).rows,
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (await query(strings, values)).rowCount } as unknown as Prisma.TransactionClient
}
async function withFixture(options: Parameters<typeof createPackageCapFixture>[1], run: (context: {
  event: (options?: { at?: string; points?: number; leg?: 'left' | 'right'; forcedEligible?: number; forcedFlush?: number; sourceId?: string; extraLotPoints?: number; fail?: boolean; omitCache?: boolean }) => Promise<void>;
  inspect: (sql: string, values?: unknown[]) => Promise<import('pg').QueryResult>;
  schema: string;
}) => Promise<void>) {
  const setup = connect(); await setup.connect(); let schema = ''
  try {
    await setup.query('BEGIN'); schema = await createPackageCapFixture(setup, options); await setup.query('COMMIT')
    async function inspect(sql: string, values: unknown[] = []) {
      await setup.query('BEGIN'); await setup.query(`SET LOCAL search_path TO "${schema}"`)
      try { const result = await setup.query(sql, values); await setup.query('COMMIT'); return result }
      catch (error) { await setup.query('ROLLBACK'); throw error }
    }
    async function event(input: { at?: string; points?: number; leg?: 'left' | 'right'; forcedEligible?: number; forcedFlush?: number; sourceId?: string; extraLotPoints?: number; fail?: boolean; omitCache?: boolean } = {}) {
      const db = connect(); await db.connect()
      try {
        await db.query('BEGIN'); await db.query(`SET LOCAL search_path TO "${schema}"`)
        await db.query("SET LOCAL statement_timeout='30s'")
        await db.query("SELECT set_config('test.cap_clock',$1,true)", [input.at || clock])
        await db.query("SELECT pg_advisory_xact_lock(hashtext('package-binary-product-reward-policy'))")
        await db.query("SELECT pg_advisory_xact_lock(hashtext('binary:member'))")
        const tx = adapter(db)
        const [cap] = await loadPackageBinaryDailyCaps(tx, ['member'])
        const p = (await db.query("SELECT * FROM reseller_profiles WHERE user_id='member'")).rows[0]
        const progress = Number((await db.query('SELECT COALESCE(SUM(payable_pairs) FILTER(WHERE reward_interval IS NOT NULL),0)::text n FROM binary_pair_events')).rows[0].n)
        const points = input.points ?? 600, leg = input.leg || 'left'
        const left = p.left_points + (leg === 'left' ? points : 0), right = p.right_points + (leg === 'right' ? points : 0)
        const sessionPlan = options?.sessions ? planPackageBinaryCarryover({ left: p.left_points, right: p.right_points, sourcePoints: points, leg, pointsPerPair: 600,
          remainingPairs: cap.enabled ? Math.max(0,Math.min(cap.cap-Number(cap.used_today),Number(cap.session_cap)-Number(cap.used_session))) : null },cap.carryover_enabled?Number(cap.carryover_limit):null) : null
        const completed = sessionPlan?.completedPairs ?? Math.floor(Math.min(left, right) / 600)
        const used = Number(cap.used_today)
        const within = input.forcedEligible ?? (cap.enabled ? Math.min(completed, Math.max(0, cap.cap - used)) : completed)
        const active = (await db.query("SELECT status FROM users WHERE id='member'")).rows[0].status === 'active'
        const eligible = active ? within : 0
        const bottles = Math.floor((progress + eligible) / 5) - Math.floor(progress / 5)
        const source = input.sourceId || randomUUID(), normalId = eligible > bottles ? randomUUID() : null, flashId = completed > eligible ? randomUUID() : null
        await db.query("INSERT INTO binary_settlement_events VALUES('registration',$1,'buyer',$2,'root',$3)", [source, points, leg])
        if (normalId) await db.query("INSERT INTO commissions VALUES($1,'binary_pairing','package-binary-v1',false,'member','buyer','registration',$2,$3,$4,NULL)", [normalId, source, (eligible - bottles) * 300, (eligible - bottles) * 600])
        if (flashId) await db.query("INSERT INTO commissions VALUES($1,'binary_pairing','package-binary-v1',true,'hiroma','buyer','registration',$2,$3,$4,'hiroma')", [flashId, source, (completed - eligible) * 300, (completed - eligible) * 600])
        const data = { ...(sessionPlan ? { source_points_flushed: input.forcedFlush ?? sessionPlan.flushedPoints } : {}), recipient_user_id: 'member', source_user_id: 'buyer', source_kind: 'registration', source_event_id: source, source_leg: leg, source_points: points,
          recipient_package_id: 'package', package_name_snapshot: 'Starter', pair_value_snapshot: 300, package_snapshot_source: 'exact_event', points_per_pair: 600, peso_per_point: 0.5,
          opening_left_points: p.left_points, opening_right_points: p.right_points, closing_left_points: sessionPlan?.leftPoints ?? left - completed * 600, closing_right_points: sessionPlan?.rightPoints ?? right - completed * 600,
          completed_pairs: completed, payable_pairs: eligible, product_reward_pairs: bottles, reward_interval: 5, reward_product_id: 'bottle', opening_reward_eligible_count: progress,
          cap_flashout_pairs: completed - within, inactive_flashout_pairs: within - eligible, consumed_left_points: completed * 600, consumed_right_points: completed * 600,
          payable_amount: (eligible - bottles) * 300, flashout_amount: (completed - eligible) * 300, cap_enabled: cap.enabled, cap_limit: cap.enabled ? cap.cap : null,
          normal_commission_id: normalId, flashout_commission_id: flashId }
        const generatedAt=new Date(input.at || clock)
        if(sessionPlan && sessionPlan.acceptedPoints>0) await createBinaryPointLot(tx,{ recipientUserId:'member', sourceUserId:'buyer',sourceKind:'registration',sourceEventId:source,leg,
          points:sessionPlan.acceptedPoints+(input.extraLotPoints || 0),generatedAt,expiryYears:3 })
        const keys = Object.keys(data)
        const inserted=await db.query(`INSERT INTO binary_pair_events(${keys.join(',')},created_at) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')},cap_test_now()) RETURNING id`, Object.values(data))
        if(sessionPlan) for(const consumedLeg of ['left','right'] as const) await consumeBinaryPointLots(tx,{recipientUserId:'member',leg:consumedLeg,points:sessionPlan.consumedPoints,pairEventId:inserted.rows[0].id,now:generatedAt})
        await db.query("UPDATE reseller_profiles SET left_points=$1,right_points=$2 WHERE user_id='member'", [data.closing_left_points, data.closing_right_points])
        if (!input.omitCache) await applyPackageBinaryCapCache(tx, 'member', used + within)
        if (input.fail) throw new Error('simulated interrupted transaction')
        await db.query('COMMIT')
      } catch (error) { await db.query('ROLLBACK'); throw error }
      finally { await db.end() }
    }
    await run({ event, inspect, schema })
  } finally { await setup.query('ROLLBACK'); if (schema) await setup.query(`DROP SCHEMA "${schema}" CASCADE`); await setup.end() }
}

test('concurrent source events share one daily allowance including fifth-pair products', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({}, async ({ event, inspect }) => {
    for (let i = 0; i < 30; i += 5) await Promise.all(Array.from({ length: 5 }, () => event()))
    const totals = (await inspect('SELECT SUM(payable_pairs)::int eligible,SUM(product_reward_pairs)::int bottles,SUM(payable_amount)::int cash,SUM(cap_flashout_pairs)::int flashed FROM binary_pair_events')).rows[0]
    assert.deepEqual(totals, { eligible: 10, bottles: 2, cash: 2400, flashed: 20 })
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n, 10)
    await assert.rejects(event({ forcedEligible: 1 }), /daily cap state|locked policy/)
    await inspect("UPDATE reseller_profiles SET daily_pairing_count=0")
    await event()
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n, 10)
    assert.equal((await inspect("SELECT daily_pairing_count n FROM reseller_profiles WHERE user_id='member'")).rows[0].n, 10)
    for (const sql of ["UPDATE binary_daily_cap_usage SET used_pairs=0", 'DELETE FROM binary_daily_cap_usage', 'TRUNCATE binary_daily_cap_usage', "INSERT INTO binary_daily_cap_usage VALUES('member','2026-11-02',0,now())"]) await assert.rejects(inspect(sql), /recorded pair event|append-only/)
    await inspect('UPDATE packages SET daily_binary_pair_cap=15')
    await event({ points: 3000 })
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n, 15)
    await inspect('UPDATE packages SET daily_binary_pair_cap=10')
    await event()
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n, 15)
  })
})

test('only one concurrent request can consume the final remaining slot', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({ used: 9, day: '2026-11-01' }, async ({ event, inspect }) => {
    await Promise.all(Array.from({ length: 10 }, () => event()))
    assert.equal((await inspect('SELECT SUM(payable_pairs)::int n FROM binary_pair_events')).rows[0].n, 1)
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n, 10)
  })
})

test('out-of-order midnight requests cannot reset either day or rewind the display cache', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({ cap: 1 }, async ({ event, inspect }) => {
    for (const at of ['2026-11-01T23:59:58+08:00', '2026-11-02T00:00:01+08:00', '2026-11-01T23:59:59+08:00', '2026-11-02T00:00:02+08:00']) await event({ at })
    const days = (await inspect('SELECT pairing_day::text,used_pairs::int FROM binary_daily_cap_usage ORDER BY pairing_day')).rows
    assert.deepEqual(days, [{ pairing_day: '2026-11-01', used_pairs: 1 }, { pairing_day: '2026-11-02', used_pairs: 1 }])
    assert.equal((await inspect('SELECT SUM(cap_flashout_pairs)::int n FROM binary_pair_events')).rows[0].n, 2)
    assert.deepEqual((await inspect("SELECT daily_pairing_date::text AS cache_day,daily_pairing_count AS used FROM reseller_profiles WHERE user_id='member'")).rows[0], { cache_day: '2026-11-02', used: 1 })
  })
})

test('failed transactions roll back usage, and unmatched points survive a full cap', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({ cap: 1 }, async ({ event, inspect }) => {
    await assert.rejects(event({ fail: true }), /interrupted/)
    assert.equal((await inspect('SELECT COUNT(*)::int n FROM binary_daily_cap_usage')).rows[0].n, 0)
    await assert.rejects(event({ omitCache: true }), /not applied atomically/)
    await event()
    await inspect("UPDATE reseller_profiles SET left_points=0,right_points=0 WHERE user_id='member'")
    await event({ points: 400 }); await event({ points: 600, leg: 'right' }); await event({ points: 600 })
    assert.deepEqual((await inspect("SELECT left_points,right_points FROM reseller_profiles WHERE user_id='member'")).rows[0], { left_points: 400, right_points: 0 })
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n, 1)
    assert.equal((await inspect('SELECT SUM(cap_flashout_pairs)::int n FROM binary_pair_events')).rows[0].n, 1)
  })
})

test('disabled caps still record usage and inactive within-cap pairs consume allowance', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({ cap: 1 }, async ({ event, inspect }) => {
    await inspect('UPDATE packages SET binary_pair_cap_enabled=false')
    await event(); await event(); await event()
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n, 3)
    await inspect('UPDATE packages SET binary_pair_cap_enabled=true')
    await event()
    assert.equal((await inspect('SELECT SUM(payable_pairs)::int n FROM binary_pair_events')).rows[0].n, 3)
    await inspect("UPDATE users SET status='inactive' WHERE id='member'")
    await event({ at: '2026-11-02T12:00:00+08:00' })
    assert.equal((await inspect("SELECT used_pairs::int n FROM binary_daily_cap_usage WHERE pairing_day='2026-11-02'")).rows[0].n, 1)
    assert.equal((await inspect('SELECT SUM(inactive_flashout_pairs)::int n FROM binary_pair_events')).rows[0].n, 1)
  })
})

test('migration preserves historical consumption and the greater legacy snapshot without changing rewards', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({ harden: false }, async ({ inspect, schema }) => {
    await inspect("UPDATE reseller_profiles SET daily_pairing_count=7,daily_pairing_date='2026-10-31'")
    // Old history can include more than the current configured cap; never erase it.
    await inspect('ALTER TABLE binary_pair_events DISABLE TRIGGER cap_test_entitlement; ALTER TABLE binary_pair_events DISABLE TRIGGER binary_pair_events_validate_closing_state')
    await inspect("INSERT INTO binary_pair_events(recipient_user_id,created_at,pairing_day,payable_pairs,inactive_flashout_pairs,cap_flashout_pairs,completed_pairs) VALUES('member',now(),'2026-10-30',12,2,0,14)")
    const original = await inspect('SELECT COUNT(*)::int n FROM package_binary_product_rewards')
    // installCapHardening needs one transaction and its schema-local search path.
    const db = connect(); await db.connect()
    try { await db.query('BEGIN'); await db.query(`SET LOCAL search_path TO "${schema}"`); await installCapHardening(db, schema); await db.query('COMMIT') }
    finally { await db.end() }
    assert.deepEqual((await inspect('SELECT pairing_day::text,used_pairs::int FROM binary_daily_cap_usage ORDER BY pairing_day')).rows, [{ pairing_day: '2026-10-30', used_pairs: 14 }, { pairing_day: '2026-10-31', used_pairs: 7 }])
    assert.deepEqual((await inspect('SELECT COUNT(*)::int n FROM package_binary_product_rewards')).rows, original.rows)
  })
})


test('two sessions admit five pairs each and reject incoming unmatched points on both legs after the cap', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({ sessions: true }, async ({ event, inspect }) => {
    assert.equal((await inspect('SELECT count(*)::int n FROM packages WHERE binary_pair_cap_enabled AND daily_binary_pair_cap=10')).rows[0].n,3)
    const audit=(await inspect('SELECT metadata FROM audit_logs')).rows[0].metadata
    assert.equal(audit.before.length,3)
    assert.equal(audit.after.daily_cap,10)
    await Promise.all(Array.from({ length: 12 }, () => event({ at: '2026-11-01T09:00:00+08:00' })))
    await event({ at: '2026-11-01T12:59:59+08:00', leg: 'right', points: 350 })
    let totals = (await inspect('SELECT SUM(payable_pairs)::int eligible,SUM(product_reward_pairs)::int bottles,SUM(source_points_flushed)::int flushed,SUM(flashout_amount)::int cash_flash FROM binary_pair_events')).rows[0]
    assert.deepEqual(totals, { eligible: 5, bottles: 1, flushed: 4550, cash_flash: 0 })
    const before = (await inspect('SELECT left_points,right_points FROM reseller_profiles')).rows[0]
    await assert.rejects(event({ forcedFlush: 0 }), /source flush/)
    await assert.rejects(event({ forcedEligible: 1 }), /inconsistent|session|daily cap state|locked policy/)
    await Promise.all(Array.from({ length: 12 }, () => event({ at: '2026-11-01T13:00:00+08:00' })))
    await event({ at: '2026-11-01T17:00:00+08:00', leg: 'right', points: 100 })
    totals = (await inspect('SELECT SUM(payable_pairs)::int eligible,SUM(product_reward_pairs)::int bottles,SUM(source_points_flushed)::int flushed,SUM(flashout_amount)::int cash_flash FROM binary_pair_events')).rows[0]
    assert.deepEqual(totals, { eligible: 10, bottles: 2, flushed: 8850, cash_flash: 0 })
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n,10)
    const after = (await inspect('SELECT left_points,right_points FROM reseller_profiles')).rows[0]
    assert.deepEqual(after,{ left_points: before.left_points, right_points: before.right_points-3000 })
    await event({ at: '2026-11-01T12:59:58+08:00' }) // delayed old-session request cannot reopen morning
    assert.equal((await inspect('SELECT SUM(payable_pairs)::int n FROM binary_pair_events')).rows[0].n,10)
    await event({ at: '2026-11-02T00:00:00+08:00' })
    assert.equal((await inspect('SELECT SUM(payable_pairs)::int n FROM binary_pair_events')).rows[0].n,11)
  })
})

test('session overshoot flushes only new surplus and rollback does not consume a session slot', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({ sessions: true }, async ({ event, inspect }) => {
    await assert.rejects(event({ points:600,extraLotPoints:1 }), /point lots/)
    assert.equal((await inspect('SELECT count(*)::int n FROM binary_pair_events')).rows[0].n,0)
    await event({ points: 2400 })
    await assert.rejects(event({ points: 1800, fail: true }), /interrupted/)
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n,4)
    await event({ points: 1900 })
    assert.deepEqual((await inspect('SELECT SUM(payable_pairs)::int eligible,SUM(source_points_flushed)::int flushed FROM binary_pair_events')).rows[0],{ eligible:5,flushed:1300 })
    await event({ at:'2026-11-01T13:00:00+08:00', points:3000 })
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n,10)
  })
})

test('unused morning slots do not transfer and inactive sessions consume allowance without bottle credit', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({ sessions: true }, async ({ event, inspect }) => {
    await event({ points:1200 })
    await event({ at:'2026-11-01T13:00:00+08:00', points:6000 })
    assert.equal((await inspect('SELECT SUM(payable_pairs)::int n FROM binary_pair_events')).rows[0].n,7)
    await inspect("UPDATE users SET status='inactive' WHERE id='member'")
    await event({ at:'2026-11-02T09:00:00+08:00',points:3600 })
    const inactive=(await inspect("SELECT payable_pairs,inactive_flashout_pairs,source_points_flushed,product_reward_pairs FROM binary_pair_events WHERE pairing_day='2026-11-02'")).rows[0]
    assert.deepEqual(inactive,{payable_pairs:0,inactive_flashout_pairs:5,source_points_flushed:600,product_reward_pairs:0})
  })
})


test('session event replay cannot repeat credits and the last morning slot is single-use under concurrency', { skip: !process.env.DATABASE_URL }, async () => {
  await withFixture({ sessions: true }, async ({ event, inspect }) => {
    const sourceId=randomUUID()
    await event({ points:2400,sourceId })
    await assert.rejects(event({ points:2400,sourceId }), /duplicate key/)
    await Promise.all(Array.from({length:8},()=>event()))
    assert.equal((await inspect('SELECT SUM(payable_pairs)::int n FROM binary_pair_events')).rows[0].n,5)
    assert.equal((await inspect('SELECT SUM(quantity)::int n FROM package_binary_product_rewards')).rows[0].n,1)
    assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n,5)
    await inspect('UPDATE reseller_profiles SET daily_pairing_count=0')
    await event()
    assert.equal((await inspect('SELECT SUM(payable_pairs)::int n FROM binary_pair_events')).rows[0].n,5)
  })
})


async function schedulePolicy(inspect: (sql:string,values?:unknown[])=>Promise<import('pg').QueryResult>, date:string, mode:string, first:number|null=null, cutoff:number|null=null) {
 await inspect(`WITH saved AS (
  INSERT INTO package_binary_cap_policies(package_id,effective_day,mode,daily_limit,first_limit,cutoff_minute,created_by)
  VALUES('package',$1::date,$2,10,$3,$4,'hiroma') RETURNING id
 ) INSERT INTO audit_logs(id,user_name,user_role,activity_type,category,description,metadata,risk_level,status)
 SELECT gen_random_uuid()::text,'Hiroma','admin','package_binary_cap_policy_scheduled','commission','Test scheduled policy',jsonb_build_object('policy_id',id::text,'actor_id','hiroma'),'high','completed' FROM saved`,[date,mode,first,cutoff])
}

test('scheduled daily anytime allows ten morning pairs and custom sessions activate only on their effective day', {skip:!process.env.DATABASE_URL},async()=>{
 await withFixture({sessions:true},async({event,inspect})=>{
  await inspect("UPDATE binary_point_lots SET expires_at='2035-01-01'")
  await schedulePolicy(inspect,'2030-01-01','daily_anytime')
  await schedulePolicy(inspect,'2030-01-02','two_sessions',3,900)
  await schedulePolicy(inspect,'2030-01-02','two_sessions',4,900) // newer version supersedes the first schedule for this date
  await event({at:'2029-12-31T09:00:00+08:00',points:6000})
  assert.equal((await inspect("SELECT SUM(payable_pairs)::int n FROM binary_pair_events WHERE pairing_day='2029-12-31'")).rows[0].n,5)
  await event({at:'2030-01-01T09:00:00+08:00',points:6000})
  await event({at:'2030-01-01T10:00:00+08:00',points:600,leg:'right'})
  const daily=(await inspect("SELECT SUM(payable_pairs)::int n,MIN(cap_session)::int s,SUM(source_points_flushed)::int flushed FROM binary_pair_events WHERE pairing_day='2030-01-01'")).rows[0]
  assert.deepEqual(daily,{n:10,s:0,flushed:600})
  await event({at:'2030-01-02T14:59:59+08:00',points:6000})
  await event({at:'2030-01-02T15:00:00+08:00',points:6000})
  const sessions=(await inspect("SELECT cap_session,SUM(payable_pairs)::int n,MIN(cap_cutoff) cutoff FROM binary_pair_events WHERE pairing_day='2030-01-02' GROUP BY cap_session ORDER BY cap_session")).rows
  assert.deepEqual(sessions,[{cap_session:1,n:4,cutoff:'15:00'},{cap_session:2,n:6,cutoff:'15:00'}])
  await event({at:'2030-01-01T23:59:59+08:00'}) // delayed prior-day settlement cannot adopt the newer mode or regain allowance
  assert.equal((await inspect("SELECT SUM(payable_pairs)::int n FROM binary_pair_events WHERE pairing_day='2030-01-01'")).rows[0].n,10)
  assert.equal((await inspect("SELECT count(*)::int n FROM binary_pair_events WHERE pairing_day>='2030-01-01' AND cap_policy_id IS NULL")).rows[0].n,0)
 })
})

test('cap policy history is immutable, future-dated, audited, and cannot be bypassed by legacy package edits', {skip:!process.env.DATABASE_URL},async()=>{
 await withFixture({sessions:true},async({inspect})=>{
  await inspect("INSERT INTO packages VALUES('new-package','New',600,false,9999)")
  assert.deepEqual((await inspect("SELECT binary_pair_cap_enabled,daily_binary_pair_cap FROM packages WHERE id='new-package'")).rows[0],{binary_pair_cap_enabled:true,daily_binary_pair_cap:10})
  await assert.rejects(inspect("UPDATE packages SET daily_binary_pair_cap=20"),/Security PIN/)
  for(const sql of ["UPDATE package_binary_cap_policies SET daily_limit=20","DELETE FROM package_binary_cap_policies","TRUNCATE package_binary_cap_policies"])await assert.rejects(inspect(sql),/immutable|append-only|foreign key/)
  await assert.rejects(schedulePolicy(inspect,'2020-01-01','daily_anytime'),/future Philippine midnight/)
  await assert.rejects(inspect("INSERT INTO package_binary_cap_policies(package_id,effective_day,mode,daily_limit,created_by) VALUES('package','2030-01-01','daily_anytime',10,'hiroma')"),/atomic owner audit/)
  await assert.rejects(inspect("INSERT INTO package_binary_cap_policies(package_id,effective_day,mode,daily_limit,created_by) VALUES('package','2030-01-01','daily_anytime',10,'member')"),/owner administrator/)
  await schedulePolicy(inspect,'2030-01-01','daily_anytime')
  assert.equal((await inspect("SELECT count(*)::int n FROM audit_logs WHERE activity_type='package_binary_cap_policy_scheduled'")).rows[0].n,1)
 })
})


async function scheduleCarry(inspect:(sql:string,values?:unknown[])=>Promise<import('pg').QueryResult>,date:string,enabled:boolean,max:number){
 await inspect(`WITH cap_version AS (
 INSERT INTO package_binary_cap_policies(package_id,effective_day,mode,daily_limit,first_limit,cutoff_minute,created_by)
 VALUES('package',$1::date,'two_sessions',10,5,780,'hiroma') RETURNING id),
 carry_version AS (INSERT INTO package_binary_carryover_policies(package_id,effective_day,enabled,max_points,cap_policy_id,created_by)
 SELECT 'package',$1::date,$2,$3,id,'hiroma' FROM cap_version RETURNING id,cap_policy_id)
 INSERT INTO audit_logs(id,user_name,user_role,activity_type,category,description,metadata,risk_level,status)
 SELECT gen_random_uuid()::text,'Hiroma','admin','package_binary_cap_policy_scheduled','commission','Carry cap test',jsonb_build_object('policy_id',cap_policy_id::text,'carryover_policy_id',id::text,'actor_id','hiroma'),'high','completed' FROM carry_version`,[date,enabled,max])
}

test('unmatched cap accepts partial room, rejects either full leg, and reopens space after matching', {skip:!process.env.DATABASE_URL},async()=>{
 for(const leg of ['left','right'] as const)await withFixture({sessions:true,left:leg==='left'?179700:0,right:leg==='right'?179700:0},async({event,inspect})=>{
  await inspect("UPDATE binary_point_lots SET expires_at='2035-01-01'")
  const at='2030-01-01T09:00:00+08:00',opposite=leg==='left'?'right':'left'
  await event({at,leg});await event({at,leg});await event({at,leg:opposite});await event({at,leg});await event({at,leg})
  const p=(await inspect('SELECT left_points,right_points FROM reseller_profiles')).rows[0]
  assert.equal(p[leg+'_points'],180000);assert.equal(p[opposite+'_points'],0)
  const sums=(await inspect('SELECT SUM(source_points_flushed)::int total,SUM(carryover_flushed_points)::int balance,SUM(session_flushed_points)::int session,SUM(payable_pairs)::int pairs FROM binary_pair_events')).rows[0]
  assert.deepEqual(sums,{total:1500,balance:1500,session:0,pairs:1})
  await event({at,leg:opposite,points:3000}) // four remaining slots, then surplus is session flush
  await event({at,leg}) // free balance space does not bypass the exhausted session
  const last=(await inspect('SELECT session_flushed_points,carryover_flushed_points FROM binary_pair_events ORDER BY created_at DESC,id DESC')).rows
  assert.equal(last.filter(r=>r.session_flushed_points===600&&r.carryover_flushed_points===0).length,2)
  assert.equal((await inspect('SELECT SUM(product_reward_pairs)::int n FROM binary_pair_events')).rows[0].n,1)
  assert.equal((await inspect('SELECT used_pairs::int n FROM binary_daily_cap_usage')).rows[0].n,5)
 })
})

test('scheduled carryover off/on and point-limit changes preserve usage and version history', {skip:!process.env.DATABASE_URL},async()=>{
 await withFixture({sessions:true,left:179700,right:0},async({event,inspect})=>{
  await inspect("UPDATE binary_point_lots SET expires_at='2035-01-01'")
  await scheduleCarry(inspect,'2030-01-02',false,180000)
  await scheduleCarry(inspect,'2030-01-03',true,200000)
  await schedulePolicy(inspect,'2030-01-04','daily_anytime') // older cap-only scheduling preserves independent carryover policy
  await event({at:'2030-01-01T09:00:00+08:00'})
  await event({at:'2030-01-02T09:00:00+08:00',points:6000})
  assert.equal((await inspect('SELECT left_points n FROM reseller_profiles')).rows[0].n,186000)
  await assert.rejects(event({at:'2030-01-03T09:00:00+08:00',points:30000,forcedFlush:0}),/source flush/)
  await event({at:'2030-01-03T09:00:00+08:00',points:30000})
  assert.equal((await inspect('SELECT left_points n FROM reseller_profiles')).rows[0].n,200000)
  await event({at:'2030-01-04T09:00:00+08:00'})
  const snapshots=(await inspect("SELECT cap_mode,carryover_cap_enabled,carryover_cap_points,carryover_flushed_points FROM binary_pair_events WHERE pairing_day='2030-01-04'")).rows[0]
  assert.deepEqual(snapshots,{cap_mode:'daily_anytime',carryover_cap_enabled:true,carryover_cap_points:200000,carryover_flushed_points:600})
  for(const sql of ['UPDATE package_binary_carryover_policies SET enabled=false','DELETE FROM package_binary_carryover_policies','TRUNCATE package_binary_carryover_policies'])await assert.rejects(inspect(sql),/immutable|append-only|foreign key/)
 })
})

test('pre-existing excess is preserved and rejects new unmatched volume until matching below the limit', {skip:!process.env.DATABASE_URL},async()=>{
 await withFixture({sessions:true,left:185000,right:0},async({event,inspect})=>{
  await inspect("UPDATE binary_point_lots SET expires_at='2035-01-01'")
  await event({at:'2030-01-01T09:00:00+08:00'})
  assert.equal((await inspect('SELECT left_points n FROM reseller_profiles')).rows[0].n,185000)
  await event({at:'2030-01-01T09:00:00+08:00',leg:'right',points:3000})
  await event({at:'2030-01-01T13:00:00+08:00',leg:'right',points:2400})
  await event({at:'2030-01-01T13:00:00+08:00'})
  assert.equal((await inspect('SELECT left_points n FROM reseller_profiles')).rows[0].n,180000)
  assert.equal((await inspect('SELECT SUM(carryover_flushed_points)::int n FROM binary_pair_events')).rows[0].n,800)
 })
})


test('carryover initialization is stable for newly created packages and full integer balances reject incoming safely', {skip:!process.env.DATABASE_URL},async()=>{
 await withFixture({sessions:true,left:2147483647,right:0},async({event,inspect})=>{
  await inspect("INSERT INTO packages VALUES('carry-new','Carry New',600,true,10)")
  assert.equal((await inspect("SELECT count(*)::int n FROM package_binary_carryover_policies WHERE package_id='carry-new' AND enabled AND max_points=180000")).rows[0].n,1)
  await event({at:'2030-01-01T09:00:00+08:00'})
  assert.equal((await inspect('SELECT left_points n FROM reseller_profiles')).rows[0].n,2147483647)
  assert.equal((await inspect('SELECT carryover_flushed_points n FROM binary_pair_events')).rows[0].n,600)
 })
})


test('matching before an integer-maximum carryover limit cannot overflow intermediate point sums', {skip:!process.env.DATABASE_URL},async()=>{
 await withFixture({sessions:true,left:2147483647,right:600},async({event,inspect})=>{
  await inspect("UPDATE binary_point_lots SET expires_at='2035-01-01'")
  await scheduleCarry(inspect,'2030-01-01',true,2147483647)
  await event({at:'2030-01-01T09:00:00+08:00'})
  assert.deepEqual((await inspect('SELECT left_points,right_points FROM reseller_profiles')).rows[0],{left_points:2147483647,right_points:0})
  assert.equal((await inspect('SELECT SUM(payable_pairs)::int n FROM binary_pair_events')).rows[0].n,1)
 })
})
