import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateBinaryCapPolicy,validateBinaryCapDate,validateCarryoverPolicy } from '../src/app/lib/packageBinaryCapPolicy'
test('cap mode validator separates daily allowance from split sessions',()=>{
 assert.deepEqual(validateBinaryCapPolicy({mode:'daily_anytime',daily_limit:10,first_limit:null,cutoff_minute:null}),{mode:'daily_anytime',daily_limit:10,first_limit:null,cutoff_minute:null})
 assert.equal(validateBinaryCapPolicy({mode:'two_sessions',daily_limit:10,first_limit:4,cutoff_minute:900}).first_limit,4)
 for(const value of [{mode:'bad',daily_limit:10},{mode:'daily_anytime',daily_limit:10,first_limit:5,cutoff_minute:780},{mode:'two_sessions',daily_limit:10,first_limit:10,cutoff_minute:780},{mode:'two_sessions',daily_limit:10,first_limit:5,cutoff_minute:1440},{mode:'daily_anytime',daily_limit:1.5,first_limit:null,cutoff_minute:null}])assert.throws(()=>validateBinaryCapPolicy(value))
 assert.equal(validateBinaryCapDate('2030-01-01'),'2030-01-01');assert.throws(()=>validateBinaryCapDate('2030-02-30'))
})
test('cap policy writes require owner, origin, PIN, a locked version check, and an atomic audit',()=>{
 const api=readFileSync('src/app/api/admin/settings/package-binary-cap/route.ts','utf8')
 for(const requirement of ["u?.role==='admin'&&u.is_staff!==true","req.headers.get('origin')!==req.nextUrl.origin",'verifyResellerSecurityPin(user.id,body.security_pin)','isSensitiveResellerPinAccepted(pin)','STALE_POLICY','expected_latest_carryover_id','pg_advisory_xact_lock','package_binary_cap_policy_scheduled','createRequiredAuditLog(tx'])assert.ok(api.includes(requirement),requirement)
 assert.ok(api.indexOf('isSensitiveResellerPinAccepted(pin)')<api.indexOf('INSERT INTO package_binary_cap_policies'))
})


test('carryover settings require a genuine toggle and a positive database-safe whole point limit',()=>{
 assert.deepEqual(validateCarryoverPolicy({enabled:true,max_points:180000}),{enabled:true,max_points:180000})
 assert.equal(validateCarryoverPolicy({enabled:false,max_points:600000}).enabled,false)
 for(const value of [null,{enabled:'true',max_points:180000},{enabled:true,max_points:0},{enabled:true,max_points:1.5},{enabled:true,max_points:2147483648}])assert.throws(()=>validateCarryoverPolicy(value))
})
