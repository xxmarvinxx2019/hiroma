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
export async function GET(req:NextRequest){
 const user=await getCurrentUser();if(!user||user.role!=='admin')return NextResponse.json({error:'Unauthorized'},{status:401})
 const now=new Date(),from=parse(req.nextUrl.searchParams.get('from'))||new Date(now.getFullYear(),now.getMonth(),1),to=parse(req.nextUrl.searchParams.get('to'),true)||now
 const status=req.nextUrl.searchParams.get('status')||'all',source=req.nextUrl.searchParams.get('source')||'all',search=(req.nextUrl.searchParams.get('search')||'').trim().toLowerCase()
 try{
  const rows=await prisma.$queryRaw<PayoutLedgerRow[]>`
   SELECT p.id,p.transaction_number,p.amount::float,p.status::text,p.payment_method,p.payment_reference,
    p.requested_at,p.processed_at,p.released_at,p.payout_date,p.notes,u.full_name,u.username,
    COALESCE((SELECT SUM(amount) FROM direct_referral_payout_consumptions WHERE payout_id=p.id),0)::float direct_referral,
    COALESCE((SELECT SUM(amount) FROM binary_payout_consumptions WHERE payout_id=p.id),0)::float binary,
    COALESCE((SELECT SUM(amount) FROM product_binary_payout_consumptions WHERE payout_id=p.id),0)::float product_binary
   FROM payouts p JOIN users u ON u.id=p.user_id
   WHERE (CASE WHEN p.status='released' THEN COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)
    WHEN p.status IN ('approved','rejected') THEN COALESCE(p.processed_at,p.requested_at) ELSE p.requested_at END)>=${from}
    AND (CASE WHEN p.status='released' THEN COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)
    WHEN p.status IN ('approved','rejected') THEN COALESCE(p.processed_at,p.requested_at) ELSE p.requested_at END)<=${to}
   ORDER BY COALESCE(p.released_at,p.processed_at,p.requested_at) DESC LIMIT 500
  `
  const enriched=rows.map(r=>({...r,unallocated:Math.max(0,n(r.amount)-n(r.direct_referral)-n(r.binary)-n(r.product_binary)),event_at:r.status==='released'?(r.released_at||r.payout_date||r.processed_at||r.requested_at):((r.status==='approved'||r.status==='rejected')?(r.processed_at||r.requested_at):r.requested_at)}))
  const filtered=enriched.filter(r=>(status==='all'||r.status===status)&&(source==='all'||n(r[source])>0)&&(search===''||`${r.transaction_number||''} ${r.full_name} ${r.username} ${r.payment_reference||''}`.toLowerCase().includes(search)))
  const total=(st:string)=>filtered.filter(r=>st==='all'||r.status===st).reduce((a,r)=>a+n(r.amount),0)
  return NextResponse.json({summary:{total_requested:total('all'),pending:total('pending'),approved:total('approved'),released:total('released'),rejected:total('rejected'),payout_count:filtered.length,direct_referral:filtered.reduce((a,r)=>a+n(r.direct_referral),0),binary:filtered.reduce((a,r)=>a+n(r.binary),0),product_binary:filtered.reduce((a,r)=>a+n(r.product_binary),0),unallocated:filtered.reduce((a,r)=>a+n(r.unallocated),0)},payouts:filtered})
 }catch(error){console.error('[PAYOUT LEDGER]',error);return NextResponse.json({error:'Unable to load payout ledger.'},{status:500})}
}
