import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import {
 evaluateBinaryReserveAdmission,
 loadBinaryReserveHealth,
 readBinaryReserveAdmissionPolicy,
} from '@/app/lib/binaryReserveAdmission'

const parseDate=(v:string|null,end=false)=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)?new Date(`${v}T${end?'23:59:59.999':'00:00:00'}+08:00`):null
const num=(v:unknown)=>Number(v||0)||0

export async function GET(req:NextRequest){
 const user=await getCurrentUser()
 if(!user||user.role!=='admin')return NextResponse.json({error:'Unauthorized'},{status:401})
 const now=new Date(),from=parseDate(req.nextUrl.searchParams.get('from'))||new Date(now.getFullYear(),now.getMonth(),1),to=parseDate(req.nextUrl.searchParams.get('to'),true)||now
 const type=req.nextUrl.searchParams.get('type')||'all'
 try{
  const [direct,binary,product,movements,integrity,settlementJobs,reserveAdmission]=await Promise.all([
   prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
     COALESCE((SELECT SUM(direct_referral_allocation) FROM registration_financials WHERE created_at<=${to}),0)::float allocated,
     COALESCE((SELECT SUM(source_allocation) FROM direct_referral_settlement_events WHERE created_at<=${to}),0)::float decided,
     (COALESCE((SELECT SUM(direct_referral_retained) FROM upgrade_financials WHERE created_at<=${to}),0)
       + COALESCE((SELECT SUM(retained_amount) FROM direct_referral_settlement_events WHERE created_at<=${to}),0))::float retained,
     COALESCE((SELECT SUM(amount) FROM commissions WHERE type='direct_referral' AND is_pair_overflow=false AND created_at<=${to}),0)::float earned,
     (COALESCE((SELECT SUM(original_amount) FROM direct_referral_reserve_lots WHERE allocated_at<=${to}),0)-COALESCE((SELECT SUM(c.amount) FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)-COALESCE((SELECT SUM(amount) FROM payable_lot_forfeitures WHERE source_type='direct_referral' AND created_at<=${to}),0))::float liability,
     COALESCE((SELECT SUM(c.amount) FROM direct_referral_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)::float paid,
     COALESCE((SELECT SUM(amount) FROM commissions WHERE type='direct_referral' AND is_pair_overflow=true AND created_at>=${from} AND created_at<=${to}),0)::float flashout,
     COALESCE((SELECT SUM(amount) FROM payable_lot_forfeitures WHERE source_type='direct_referral' AND created_at>=${from} AND created_at<=${to}),0)::float forfeited
   `,
   prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT COALESCE((SELECT SUM(original_amount) FROM binary_reserve_lots WHERE allocated_at<=${to}),0)::float allocated,
     (COALESCE((SELECT SUM(original_amount) FROM binary_reserve_lots WHERE allocated_at<=${to}),0)-COALESCE((SELECT SUM(amount) FROM binary_reserve_consumptions WHERE is_unfunded=false AND consumed_at<=${to}),0))::float available,
     (COALESCE((SELECT SUM(original_amount) FROM binary_payable_lots WHERE allocated_at<=${to}),0)-COALESCE((SELECT SUM(c.amount) FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)-COALESCE((SELECT SUM(amount) FROM payable_lot_forfeitures WHERE source_type='binary' AND created_at<=${to}),0))::float liability,
     COALESCE((SELECT SUM(c.amount) FROM binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)::float paid,
     COALESCE((SELECT SUM(amount) FROM commissions WHERE type='binary_pairing' AND is_pair_overflow=true AND created_at>=${from} AND created_at<=${to}),0)::float flashout,
     COALESCE((SELECT SUM(amount) FROM binary_reserve_consumptions WHERE is_unfunded=true AND consumed_at<=${to}),0)::float shortfall,
     COALESCE((SELECT SUM(amount) FROM payable_lot_forfeitures WHERE source_type='binary' AND created_at>=${from} AND created_at<=${to}),0)::float forfeited
   `,
   prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT COALESCE((SELECT SUM(original_amount) FROM product_binary_funding_lots WHERE reconciliation_status='exact' AND allocated_at<=${to}),0)::float allocated,
     COALESCE((SELECT SUM(remaining_amount) FROM product_binary_funding_lots WHERE reconciliation_status='exact' AND allocated_at<=${to}),0)::float available,
     (COALESCE((SELECT SUM(original_amount) FROM product_binary_payable_lots WHERE allocated_at<=${to}),0)-COALESCE((SELECT SUM(c.amount) FROM product_binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)-COALESCE((SELECT SUM(amount) FROM payable_lot_forfeitures WHERE source_type='product_binary' AND created_at<=${to}),0))::float liability,
     COALESCE((SELECT SUM(c.amount) FROM product_binary_payout_consumptions c JOIN payouts p ON p.id=c.payout_id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}),0)::float paid,
     COALESCE((SELECT SUM(amount) FROM commissions WHERE type='sponsor_point' AND is_pair_overflow=true AND created_at>=${from} AND created_at<=${to}),0)::float flashout,
     COALESCE((SELECT SUM(amount) FROM product_binary_funding_consumptions WHERE is_unfunded=true AND consumed_at<=${to}),0)::float shortfall,
     COALESCE((SELECT SUM(amount) FROM payable_lot_forfeitures WHERE source_type='product_binary' AND created_at>=${from} AND created_at<=${to}),0)::float forfeited
   `,
   prisma.$queryRaw<Record<string, unknown>[]>`
    WITH entries AS (
     SELECT rf.created_at at,'direct_referral' reserve_type,'commitment' movement_type,c.id reference,c.user_id member_id,c.amount::float amount,'Direct referral earned' description FROM commissions c JOIN direct_referral_reserve_lots rf ON rf.commission_id=c.id WHERE rf.created_at>=${from} AND rf.created_at<=${to}
     UNION ALL SELECT b.allocated_at,'binary','allocation',COALESCE(b.registration_financial_id::text,b.upgrade_financial_id::text,b.id::text),NULL,b.original_amount::float,'Registration / upgrade binary reserve' FROM binary_reserve_lots b WHERE b.allocated_at>=${from} AND b.allocated_at<=${to}
     UNION ALL SELECT d.created_at,'direct_referral','settlement',d.source_event_id,d.referred_user_id,d.source_allocation::float,'Direct Referral decision: ' || d.disposition || ' (paid ' || d.payable_amount::text || ', retained ' || d.retained_amount::text || ')' FROM direct_referral_settlement_events d WHERE d.created_at>=${from} AND d.created_at<=${to}
     UNION ALL SELECT p.allocated_at,'product_binary',CASE WHEN p.reconciliation_status='exact' THEN 'allocation' ELSE 'quarantined' END,COALESCE(p.order_id,p.inventory_movement_id::text,p.id::text),NULL,p.original_amount::float,CASE WHEN p.reconciliation_status='exact' THEN 'Paid-and-delivered Admin order funding (capped at ₱20 per eligible unit)' ELSE 'Legacy Product Binary source quarantined; not spendable funding' END FROM product_binary_funding_lots p WHERE p.allocated_at>=${from} AND p.allocated_at<=${to}
     UNION ALL SELECT c.created_at,CASE WHEN c.type='direct_referral' THEN 'direct_referral' WHEN c.type='binary_pairing' THEN 'binary' ELSE 'product_binary' END,'flashout',c.id,c.source_user_id,c.amount::float,'Commission flashout retained by Hiroma' FROM commissions c WHERE c.is_pair_overflow=true AND c.created_at>=${from} AND c.created_at<=${to}
     UNION ALL SELECT COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at),'direct_referral','released',p.id,p.user_id,c.amount::float,'Released payout allocation' FROM payouts p JOIN direct_referral_payout_consumptions c ON c.payout_id=p.id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}
     UNION ALL SELECT COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at),'binary','released',p.id,p.user_id,c.amount::float,'Released payout allocation' FROM payouts p JOIN binary_payout_consumptions c ON c.payout_id=p.id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}
      UNION ALL SELECT COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at),'product_binary','released',p.id,p.user_id,c.amount::float,'Released payout allocation' FROM payouts p JOIN product_binary_payout_consumptions c ON c.payout_id=p.id WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)>=${from} AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at)<=${to}
      UNION ALL SELECT f.created_at,f.source_type,'deactivation_forfeit',f.deactivation_event_id,e.reseller_id,f.amount::float,'Payable liability liquidated on reseller deactivation' FROM payable_lot_forfeitures f JOIN reseller_deactivation_events e ON e.id=f.deactivation_event_id WHERE f.created_at>=${from} AND f.created_at<=${to}
    ) SELECT e.*,u.full_name member_name,u.username FROM entries e LEFT JOIN users u ON u.id=e.member_id WHERE (${type}='all' OR e.reserve_type=${type}) ORDER BY at DESC LIMIT 300
   `,
   prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
      COUNT(*) FILTER (WHERE ABS(unreconciled_balance) >= 0.01)::int unreconciled_wallets,
      COALESCE(SUM(unreconciled_balance) FILTER (WHERE unreconciled_balance > 0),0)::float unsupported_positive_balance,
      COALESCE(SUM(-unreconciled_balance) FILTER (WHERE unreconciled_balance < 0),0)::float liability_deficit,
      COALESCE(SUM(source_backed_liability),0)::float source_backed_liability,
      COALESCE(SUM(balance),0)::float wallet_balance,
      (SELECT COUNT(*) FROM pins WHERE pin_type='registration' AND status='unused' AND registration_points_snapshot IS NULL)::int unreconciled_registration_pins,
      (SELECT COUNT(*) FROM pins WHERE pin_type='upgrade' AND status='unused' AND NOT upgrade_pin_snapshot_is_exact(id))::int unreconciled_upgrade_pins,
      (SELECT COUNT(*) FROM pin_requests WHERE status='pending' AND registration_snapshot IS NULL)::int unreconciled_pin_requests,
      (SELECT COUNT(*)::int
       FROM registration_financials rf
       WHERE rf.payment_status='paid'
         AND NOT EXISTS (
           SELECT 1 FROM direct_referral_settlement_events event
           WHERE event.registration_financial_id=rf.id
             AND event.source_event_id=rf.pin_id
             AND event.referred_user_id=rf.reseller_id
             AND event.source_allocation=rf.direct_referral_allocation
         )) legacy_direct_referral_settlements,
      (SELECT COUNT(*)::int
       FROM direct_referral_settlement_events event
       WHERE event.payable_amount + event.retained_amount <> event.source_allocation
          OR (event.payable_amount > 0) <> (event.normal_commission_id IS NOT NULL)
          OR (event.disposition <> 'retained_system_root' AND (event.retained_amount > 0) <> (event.retained_commission_id IS NOT NULL))) unreconciled_direct_referral_settlements,
      (SELECT COUNT(*)::int
       FROM payouts payout
       CROSS JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE entry_type='payout_reservation')::int reservation_count,
           COALESCE(SUM(reserved_delta) FILTER (WHERE entry_type='payout_reservation'),0) reservation_amount,
           COUNT(*) FILTER (WHERE entry_type='payout_reservation_release')::int release_count,
           COALESCE(SUM(reserved_delta) FILTER (WHERE entry_type='payout_reservation_release'),0) release_amount,
           COUNT(*) FILTER (WHERE entry_type='payout_disbursement')::int disbursement_count,
           COALESCE(SUM(-balance_delta) FILTER (WHERE entry_type='payout_disbursement'),0) disbursement_amount
         FROM wallet_ledger_entries WHERE payout_id=payout.id
       ) ledger
       CROSS JOIN LATERAL (
         SELECT COALESCE(SUM(amount),0) allocation_amount FROM (
           SELECT amount FROM direct_referral_payout_consumptions WHERE payout_id=payout.id
           UNION ALL SELECT amount FROM binary_payout_consumptions WHERE payout_id=payout.id
           UNION ALL SELECT amount FROM product_binary_payout_consumptions WHERE payout_id=payout.id
         ) sources
       ) allocation
       WHERE ledger.reservation_count<>1 OR ledger.reservation_amount<>payout.amount
          OR (payout.status='pending' AND (ledger.release_count<>0 OR ledger.disbursement_count<>0 OR allocation.allocation_amount<>0))
          OR (payout.status='rejected' AND (ledger.release_count<>1 OR ledger.release_amount<>-payout.amount OR ledger.disbursement_count<>0 OR allocation.allocation_amount<>0))
          OR (payout.status='approved' AND (ledger.release_count<>0 OR ledger.disbursement_count<>0 OR allocation.allocation_amount<>payout.amount))
          OR (payout.status='released' AND (ledger.release_count<>0 OR ledger.disbursement_count<>1 OR ledger.disbursement_amount<>payout.amount OR allocation.allocation_amount<>payout.amount))
       ) unreconciled_payouts
      ,(SELECT COUNT(*)::int FROM product_binary_funding_lots WHERE reconciliation_status<>'exact') legacy_product_binary_funding_lots
      ,(SELECT COALESCE(SUM(original_amount),0) FROM product_binary_funding_lots WHERE reconciliation_status<>'exact') legacy_product_binary_funding_amount
      ,(SELECT COUNT(*)::int FROM reseller_deactivation_events WHERE liability_liquidation_version IS NULL) legacy_deactivation_events
      ,(SELECT COUNT(*)::int
        FROM reseller_deactivation_events e
        WHERE e.liability_liquidation_version='deactivation-liability-v1'
          AND (
            (SELECT COUNT(*) FROM wallet_ledger_entries w WHERE w.entry_type='deactivation_forfeit' AND w.source_kind='deactivation' AND w.source_event_id=e.id AND w.user_id=e.reseller_id)<>1
            OR (SELECT COALESCE(SUM(-w.balance_delta),0) FROM wallet_ledger_entries w WHERE w.entry_type='deactivation_forfeit' AND w.source_kind='deactivation' AND w.source_event_id=e.id AND w.user_id=e.reseller_id)<>e.wallet_value
            OR (SELECT COALESCE(SUM(f.amount),0) FROM payable_lot_forfeitures f WHERE f.deactivation_event_id=e.id)<>e.wallet_value
            OR (e.wallet_value>0 AND (SELECT COUNT(*) FROM commissions c WHERE c.source_event_kind='deactivation' AND c.source_event_id=e.id AND c.type='deactivation_wallet_transfer' AND c.amount=e.wallet_value AND c.source_user_id=e.reseller_id AND c.is_pair_overflow=true)<>1)
            OR (e.wallet_value=0 AND (SELECT COUNT(*) FROM commissions c WHERE c.source_event_kind='deactivation' AND c.source_event_id=e.id)<>0)
            OR (SELECT COUNT(*) FROM audit_logs a WHERE a.activity_type='reseller_deactivated' AND a.status='completed' AND a.metadata->>'deactivation_event_id'=e.id)<>1
          )) unreconciled_deactivations
    FROM wallet_funding_reconciliation
   `,
   prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT status,qualification_status,COUNT(*)::int count,MIN(created_at) oldest,
      COALESCE(MAX(last_error),'') last_error
    FROM product_binary_settlement_jobs
    WHERE status<>'completed'
       OR qualification_status NOT IN ('qualified_paid_delivery','ineligible_zero_pu')
    GROUP BY status,qualification_status
    ORDER BY status,qualification_status
   `,
   prisma.$transaction(async(tx)=>evaluateBinaryReserveAdmission({
    health:await loadBinaryReserveHealth(tx),
    requestedBinaryAllocation:0,
    policy:readBinaryReserveAdmissionPolicy(),
   })),
  ])
  const d=direct[0]||{},b=binary[0]||{},p=product[0]||{}
  const rows=[
   {key:'direct_referral',label:'Direct Referral',allocated:num(d.allocated),available:Math.max(0,num(d.allocated)-num(d.decided)),liability:num(d.liability),paid:num(d.paid),retained:num(d.retained),flashout:num(d.flashout),forfeited:num(d.forfeited),shortfall:Math.max(0,num(d.earned)-num(d.allocated))},
   {key:'binary',label:'Binary Commission',allocated:num(b.allocated),available:num(b.available),liability:num(b.liability),paid:num(b.paid),retained:0,flashout:num(b.flashout),forfeited:num(b.forfeited),shortfall:num(b.shortfall)},
   {key:'product_binary',label:'Product Binary',allocated:num(p.allocated),available:num(p.available),liability:num(p.liability),paid:num(p.paid),retained:0,flashout:num(p.flashout),forfeited:num(p.forfeited),shortfall:num(p.shortfall)},
  ]
  const sum=(k:keyof typeof rows[number])=>rows.reduce((a,r)=>a+(typeof r[k]==='number'?r[k] as number:0),0)
  return NextResponse.json({
   range:{from,to},
   summary:{total_allocated:sum('allocated'),available_reserve:sum('available'),total_liability:sum('liability'),total_paid:sum('paid'),total_direct_retained:sum('retained'),total_flashout:sum('flashout'),total_deactivation_forfeited:sum('forfeited'),funding_shortfall:sum('shortfall')},
   integrity:integrity[0]||{},
   reserve_admission:reserveAdmission,
   product_binary_jobs:settlementJobs,
   reserves:rows,
   movements,
  })
 }catch(error){console.error('[RESERVE LEDGER]',error);return NextResponse.json({error:'Unable to load consolidated reserve ledger.'},{status:500})}
}
