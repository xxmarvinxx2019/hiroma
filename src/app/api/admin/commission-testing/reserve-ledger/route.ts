import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const parseDate=(v:string|null,end=false)=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)?new Date(`${v}T${end?'23:59:59.999':'00:00:00'}+08:00`):null
const num=(v:unknown)=>Number(v||0)||0

export async function GET(req:NextRequest){
 const user=await getCurrentUser()
 if(!user||user.role!=='admin')return NextResponse.json({error:'Unauthorized'},{status:401})
 const now=new Date(),from=parseDate(req.nextUrl.searchParams.get('from'))||new Date(now.getFullYear(),now.getMonth(),1),to=parseDate(req.nextUrl.searchParams.get('to'),true)||now
 const type=req.nextUrl.searchParams.get('type')||'all'
 try{
  const [direct,binary,product,movements]=await Promise.all([
   prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
     (COALESCE((SELECT SUM(direct_referral_allocation) FROM registration_financials WHERE created_at<=${to}),0)+COALESCE((SELECT SUM(direct_referral_allocation) FROM upgrade_financials WHERE created_at<=${to}),0))::float allocated,
     COALESCE((SELECT SUM(amount) FROM commissions WHERE type='direct_referral' AND is_pair_overflow=false AND created_at<=${to}),0)::float earned,
     (COALESCE((SELECT SUM(original_amount) FROM direct_referral_reserve_lots WHERE allocated_at<=${to}),0)-COALESCE((SELECT SUM(c.amount) FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0))::float liability,
     COALESCE((SELECT SUM(c.amount) FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)::float paid,
     COALESCE((SELECT SUM(amount) FROM commissions WHERE type='direct_referral' AND is_pair_overflow=true AND created_at>=${from} AND created_at<=${to}),0)::float flashout
   `,
   prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT COALESCE((SELECT SUM(original_amount) FROM binary_reserve_lots WHERE allocated_at<=${to}),0)::float allocated,
     (COALESCE((SELECT SUM(original_amount) FROM binary_reserve_lots WHERE allocated_at<=${to}),0)-COALESCE((SELECT SUM(amount) FROM binary_reserve_consumptions WHERE is_unfunded=false AND consumed_at<=${to}),0))::float available,
     (COALESCE((SELECT SUM(original_amount) FROM binary_payable_lots WHERE allocated_at<=${to}),0)-COALESCE((SELECT SUM(c.amount) FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0))::float liability,
     COALESCE((SELECT SUM(c.amount) FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)::float paid,
     COALESCE((SELECT SUM(amount) FROM commissions WHERE type='binary_pairing' AND is_pair_overflow=true AND created_at>=${from} AND created_at<=${to}),0)::float flashout,
     COALESCE((SELECT SUM(amount) FROM binary_reserve_consumptions WHERE is_unfunded=true AND consumed_at<=${to}),0)::float shortfall
   `,
   prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT COALESCE((SELECT SUM(original_amount) FROM product_binary_funding_lots WHERE allocated_at<=${to}),0)::float allocated,
     (COALESCE((SELECT SUM(original_amount) FROM product_binary_funding_lots WHERE allocated_at<=${to}),0)-COALESCE((SELECT SUM(amount) FROM product_binary_funding_consumptions WHERE is_unfunded=false AND consumed_at<=${to}),0))::float available,
     (COALESCE((SELECT SUM(original_amount) FROM product_binary_payable_lots WHERE allocated_at<=${to}),0)-COALESCE((SELECT SUM(c.amount) FROM product_binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0))::float liability,
     COALESCE((SELECT SUM(c.amount) FROM product_binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)::float paid,
     COALESCE((SELECT SUM(amount) FROM commissions WHERE type='sponsor_point' AND is_pair_overflow=true AND created_at>=${from} AND created_at<=${to}),0)::float flashout,
     COALESCE((SELECT SUM(amount) FROM product_binary_funding_consumptions WHERE is_unfunded=true AND consumed_at<=${to}),0)::float shortfall
   `,
   prisma.$queryRaw<Record<string, unknown>[]>`
    WITH entries AS (
     SELECT rf.created_at at,'direct_referral' reserve_type,'commitment' movement_type,c.id reference,c.user_id member_id,c.amount::float amount,'Direct referral earned' description FROM commissions c JOIN direct_referral_reserve_lots rf ON rf.commission_id=c.id WHERE rf.created_at>=${from} AND rf.created_at<=${to}
     UNION ALL SELECT b.allocated_at,'binary','allocation',COALESCE(b.registration_financial_id::text,b.upgrade_financial_id::text,b.id::text),NULL,b.original_amount::float,'Registration / upgrade binary reserve' FROM binary_reserve_lots b WHERE b.allocated_at>=${from} AND b.allocated_at<=${to}
     UNION ALL SELECT p.allocated_at,'product_binary','allocation',COALESCE(p.inventory_movement_id::text,p.id::text),NULL,p.original_amount::float,'₱20 maximum allocation per eligible product' FROM product_binary_funding_lots p WHERE p.allocated_at>=${from} AND p.allocated_at<=${to}
     UNION ALL SELECT c.created_at,CASE WHEN c.type='direct_referral' THEN 'direct_referral' WHEN c.type='binary_pairing' THEN 'binary' ELSE 'product_binary' END,'flashout',c.id,c.source_user_id,c.amount::float,'Commission flashout retained by Hiroma' FROM commissions c WHERE c.is_pair_overflow=true AND c.created_at>=${from} AND c.created_at<=${to}
     UNION ALL SELECT COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at),'direct_referral','released',p.id,p.user_id,c.amount::float,'Released payout allocation' FROM payouts p JOIN direct_referral_payout_consumptions c ON c.payout_id=p.id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}
     UNION ALL SELECT COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at),'binary','released',p.id,p.user_id,c.amount::float,'Released payout allocation' FROM payouts p JOIN binary_payout_consumptions c ON c.payout_id=p.id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}
     UNION ALL SELECT COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at),'product_binary','released',p.id,p.user_id,c.amount::float,'Released payout allocation' FROM payouts p JOIN product_binary_payout_consumptions c ON c.payout_id=p.id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}
    ) SELECT e.*,u.full_name member_name,u.username FROM entries e LEFT JOIN users u ON u.id=e.member_id WHERE (${type}='all' OR e.reserve_type=${type}) ORDER BY at DESC LIMIT 300
   `,
  ])
  const d=direct[0]||{},b=binary[0]||{},p=product[0]||{}
  const rows=[
   {key:'direct_referral',label:'Direct Referral',allocated:num(d.allocated),available:Math.max(0,num(d.allocated)-num(d.earned)),liability:num(d.liability),paid:num(d.paid),flashout:num(d.flashout),shortfall:Math.max(0,num(d.earned)-num(d.allocated))},
   {key:'binary',label:'Binary Commission',allocated:num(b.allocated),available:num(b.available),liability:num(b.liability),paid:num(b.paid),flashout:num(b.flashout),shortfall:num(b.shortfall)},
   {key:'product_binary',label:'Product Binary',allocated:num(p.allocated),available:num(p.available),liability:num(p.liability),paid:num(p.paid),flashout:num(p.flashout),shortfall:num(p.shortfall)},
  ]
  const sum=(k:keyof typeof rows[number])=>rows.reduce((a,r)=>a+(typeof r[k]==='number'?r[k] as number:0),0)
  return NextResponse.json({range:{from,to},summary:{total_allocated:sum('allocated'),available_reserve:sum('available'),total_liability:sum('liability'),total_paid:sum('paid'),total_flashout:sum('flashout'),funding_shortfall:sum('shortfall')},reserves:rows,movements})
 }catch(error){console.error('[RESERVE LEDGER]',error);return NextResponse.json({error:'Unable to load consolidated reserve ledger.'},{status:500})}
}
