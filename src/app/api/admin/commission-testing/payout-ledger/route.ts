import {NextRequest,NextResponse} from 'next/server'
import {getCurrentUser} from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
const parse=(v:string|null,end=false)=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)?new Date(`${v}T${end?'23:59:59.999':'00:00:00'}+08:00`):null
const n=(v:unknown)=>Number(v||0)||0
type PayoutLedgerRow = {
 id:string; transaction_number:string; amount:number; status:string; payment_method:string|null; payment_reference:string|null;
 requested_at:Date; processed_at:Date|null; released_at:Date|null; payout_date:Date|null; notes:string|null;
 full_name:string; username:string; direct_referral:number; binary:number; product_binary:number;
 [key:string]: string | number | Date | null;
}
type PayoutLedgerSummary = {
 total_requested:number; pending:number; approved:number; released:number; rejected:number; payout_count:number;
 direct_referral:number; binary:number; product_binary:number; unallocated:number;
}
export async function GET(req:NextRequest){
 const user=await getCurrentUser();if(!user||user.role!=='admin')return NextResponse.json({error:'Unauthorized'},{status:401})
 const now=new Date(),from=parse(req.nextUrl.searchParams.get('from'))||new Date(now.getFullYear(),now.getMonth(),1),to=parse(req.nextUrl.searchParams.get('to'),true)||now
 const status=req.nextUrl.searchParams.get('status')||'all',source=req.nextUrl.searchParams.get('source')||'all',search=(req.nextUrl.searchParams.get('search')||'').trim().toLowerCase()
 try{
  const [summaryRows, rows] = await Promise.all([
   prisma.$queryRaw<PayoutLedgerSummary[]>`
    WITH filtered AS (
     SELECT p.amount::float amount,p.status::text status,
      COALESCE((SELECT SUM(amount) FROM direct_referral_payout_consumptions WHERE payout_id=p.id),0)::float direct_referral,
      COALESCE((SELECT SUM(amount) FROM binary_payout_consumptions WHERE payout_id=p.id),0)::float binary,
      COALESCE((SELECT SUM(amount) FROM product_binary_payout_consumptions WHERE payout_id=p.id),0)::float product_binary
     FROM payouts p JOIN users u ON u.id=p.user_id
     WHERE (CASE WHEN p.status='released' THEN COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)
       WHEN p.status IN ('approved','rejected') THEN COALESCE(p.processed_at,p.requested_at) ELSE p.requested_at END) BETWEEN ${from} AND ${to}
      AND (${status}='all' OR p.status::text=${status})
      AND (${source}='all'
       OR (${source}='direct_referral' AND EXISTS(SELECT 1 FROM direct_referral_payout_consumptions WHERE payout_id=p.id))
       OR (${source}='binary' AND EXISTS(SELECT 1 FROM binary_payout_consumptions WHERE payout_id=p.id))
       OR (${source}='product_binary' AND EXISTS(SELECT 1 FROM product_binary_payout_consumptions WHERE payout_id=p.id)))
      AND (${search}='' OR LOWER(CONCAT_WS(' ',p.transaction_number,u.full_name,u.username,p.payment_reference)) LIKE ${`%${search}%`})
    ) SELECT COALESCE(SUM(amount),0)::float total_requested,
      COALESCE(SUM(amount) FILTER(WHERE status='pending'),0)::float pending,
      COALESCE(SUM(amount) FILTER(WHERE status='approved'),0)::float approved,
      COALESCE(SUM(amount) FILTER(WHERE status='released'),0)::float released,
      COALESCE(SUM(amount) FILTER(WHERE status='rejected'),0)::float rejected,
      COUNT(*)::int payout_count,COALESCE(SUM(direct_referral),0)::float direct_referral,
      COALESCE(SUM(binary),0)::float binary,COALESCE(SUM(product_binary),0)::float product_binary,
      COALESCE(SUM(GREATEST(amount-direct_referral-binary-product_binary,0)),0)::float unallocated
    FROM filtered
   `,
   prisma.$queryRaw<PayoutLedgerRow[]>`
    SELECT p.id,p.transaction_number,p.amount::float,p.status::text,p.payment_method,p.payment_reference,
     p.requested_at,p.processed_at,p.released_at,p.payout_date,p.notes,u.full_name,u.username,
     COALESCE((SELECT SUM(amount) FROM direct_referral_payout_consumptions WHERE payout_id=p.id),0)::float direct_referral,
     COALESCE((SELECT SUM(amount) FROM binary_payout_consumptions WHERE payout_id=p.id),0)::float binary,
     COALESCE((SELECT SUM(amount) FROM product_binary_payout_consumptions WHERE payout_id=p.id),0)::float product_binary
    FROM payouts p JOIN users u ON u.id=p.user_id
    WHERE (CASE WHEN p.status='released' THEN COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)
      WHEN p.status IN ('approved','rejected') THEN COALESCE(p.processed_at,p.requested_at) ELSE p.requested_at END) BETWEEN ${from} AND ${to}
     AND (${status}='all' OR p.status::text=${status})
     AND (${source}='all'
      OR (${source}='direct_referral' AND EXISTS(SELECT 1 FROM direct_referral_payout_consumptions WHERE payout_id=p.id))
      OR (${source}='binary' AND EXISTS(SELECT 1 FROM binary_payout_consumptions WHERE payout_id=p.id))
      OR (${source}='product_binary' AND EXISTS(SELECT 1 FROM product_binary_payout_consumptions WHERE payout_id=p.id)))
     AND (${search}='' OR LOWER(CONCAT_WS(' ',p.transaction_number,u.full_name,u.username,p.payment_reference)) LIKE ${`%${search}%`})
    ORDER BY COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) DESC LIMIT 500
   `,
  ])
  const payouts=rows.map(r=>({...r,unallocated:Math.max(0,n(r.amount)-n(r.direct_referral)-n(r.binary)-n(r.product_binary)),event_at:r.status==='released'?(r.released_at||r.payout_date||r.processed_at||r.requested_at):((r.status==='approved'||r.status==='rejected')?(r.processed_at||r.requested_at):r.requested_at)}))
  return NextResponse.json({summary:summaryRows[0],payouts})
 }catch(error){console.error('[PAYOUT LEDGER]',error);return NextResponse.json({error:'Unable to load payout ledger.'},{status:500})}
}
