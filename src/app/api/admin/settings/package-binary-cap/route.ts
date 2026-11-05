import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { validateBinaryCapDate, validateBinaryCapPolicy, validateCarryoverPolicy } from '@/app/lib/packageBinaryCapPolicy'
import { verifyResellerSecurityPin, isSensitiveResellerPinAccepted, getSensitiveResellerPinFailure } from '@/app/lib/resellerSecurityPin'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'
import { PACKAGE_REWARD_LOCK } from '@/app/lib/packageBinaryReward'
const headers={'Cache-Control':'no-store'}
async function owner(){const u=await getCurrentUser();return u?.role==='admin'&&u.is_staff!==true?u:null}
export async function GET(){
 if(!await owner())return NextResponse.json({error:'Admin owner access is required.'},{status:403,headers})
 try {
  const data=await prisma.$transaction(async tx=>{
   const [ready]=await tx.$queryRaw<{ready:boolean}[]>`SELECT to_regprocedure('public.package_binary_shared_policy_package()') IS NOT NULL AS ready`
   if(!ready.ready)return null
   const [dates]=await tx.$queryRaw<{tomorrow:string}[]>`SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Manila')::date+1)::text tomorrow`
   const [sharedPolicy]=await tx.$queryRaw<{id:string;name:string;current:unknown;versions:unknown[]}[]>`
    SELECT p.id::text,p.name,to_jsonb(s) AS current,
      COALESCE((SELECT jsonb_agg(v) FROM (SELECT id::text,revision::text,effective_day::text,mode,enabled,daily_limit,first_limit,cutoff_minute,created_by,created_at
       FROM package_binary_cap_policies WHERE package_id=p.id ORDER BY revision DESC LIMIT 20) v),'[]'::jsonb) AS versions
    FROM packages p CROSS JOIN LATERAL package_binary_cap_state_v2(p.id,'',CURRENT_TIMESTAMP) s WHERE p.id=package_binary_shared_policy_package()
   `
   return {...dates,sharedPolicy}
  },{isolationLevel:'RepeatableRead'})
  if(!data)return NextResponse.json({error:'Apply migration 20261103190000_shared_package_binary_policy before using cap settings.'},{status:503,headers})
  return NextResponse.json(data,{headers})
 }catch(error){console.error('[BINARY CAP POLICY]',error);return NextResponse.json({error:'Unable to load cap policy.'},{status:500,headers})}
}
export async function PATCH(req:NextRequest){
 const user=await owner();if(!user)return NextResponse.json({error:'Admin owner access is required.'},{status:403,headers})
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403,headers})
 let body,policy,date,carryover
 try {body=await req.json();policy=validateBinaryCapPolicy(body.policy);date=validateBinaryCapDate(body.effective_day)
  carryover=validateCarryoverPolicy({enabled:true,max_points:body.carryover_limit})
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Invalid cap policy.'},{status:400,headers})}
 const pin=await verifyResellerSecurityPin(user.id,body.security_pin)
 if(!isSensitiveResellerPinAccepted(pin)){const failure=getSensitiveResellerPinFailure(pin);return NextResponse.json({error:failure.error},{status:failure.status,headers})}
 try {
  const result=await prisma.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PACKAGE_REWARD_LOCK}))`
   const [pkg]=await tx.$queryRaw<{id:string;points:number}[]>`SELECT id,ROUND(pairing_bonus_value)::int AS points FROM packages WHERE id=package_binary_shared_policy_package() FOR SHARE`
   if(!pkg)throw new Error('PACKAGE_MISSING')
   const [minimum]=await tx.$queryRaw<{points:number}[]>`SELECT COALESCE(MAX(ROUND(pairing_bonus_value)),1)::int AS points FROM packages`
   if(carryover.max_points<minimum.points)throw new Error('CARRYOVER_TOO_SMALL')
   const [latest]=await tx.$queryRaw<{id:string}[]>`SELECT id::text FROM package_binary_cap_policies WHERE package_id=${pkg.id} ORDER BY revision DESC LIMIT 1`
   if((body.expected_latest_id??null)!==(latest?.id??null))throw new Error('STALE_POLICY')
   const [previous]=await tx.$queryRaw<{snapshot:Record<string,unknown>}[]>`SELECT to_jsonb(s) snapshot FROM package_binary_cap_state_v2(${pkg.id},'',CURRENT_TIMESTAMP) s`
   const [saved]=await tx.$queryRaw<{id:string;effective_day:string}[]>`
    INSERT INTO package_binary_cap_policies(package_id,effective_day,mode,enabled,daily_limit,first_limit,cutoff_minute,created_by)
    VALUES(${pkg.id},${date}::date,${policy.mode},true,${policy.daily_limit},${policy.first_limit},${policy.cutoff_minute},${user.id})
    RETURNING id::text,effective_day::text
   `
   const [carrySaved]=await tx.$queryRaw<{id:string}[]>`
    INSERT INTO package_binary_carryover_policies(package_id,effective_day,enabled,max_points,cap_policy_id,created_by)
    VALUES(${pkg.id},${date}::date,true,${carryover.max_points},${saved.id}::uuid,${user.id})
    RETURNING id::text
   `
   await createRequiredAuditLog(tx,{user_id:user.id,user_name:user.full_name,user_role:'admin',activity_type:'package_binary_cap_policy_scheduled',category:'commission',
    description:`Scheduled ${policy.mode} Package Binary cap from ${date} Philippine midnight.`,metadata:{policy_id:saved.id,carryover_policy_id:carrySaved.id,carryover,actor_id:user.id,package_id:pkg.id,before:previous.snapshot,previous_latest_id:latest?.id??null,after:policy,effective_day:date},risk_level:'high',status:'completed',...getClientInfo(req)})
   return saved
  })
  return NextResponse.json({success:true,...result},{headers})
 }catch(error){const message=error instanceof Error?error.message:''
  const stale=message==='STALE_POLICY';const tooSmall=message==='CARRYOVER_TOO_SMALL';const invalid=tooSmall||message==='PACKAGE_MISSING'||message.includes('future Philippine midnight')
  console.error('[BINARY CAP SCHEDULE]',message)
  return NextResponse.json({error:stale?'Policy changed since you loaded it. Reload before saving.':tooSmall?'The point limit must allow one pair for every package.':invalid?'The Starter package and a future Philippine effective date are required.':'Unable to schedule cap policy.'},{status:stale?409:invalid?400:500,headers})
 }
}
