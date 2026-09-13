# Financial hardening rollout

This release makes commission and payout correctness a database invariant. It
does not replace treasury management: Hiroma must still keep actual cash equal
to or above the protected obligations recorded by the system.

## Temporary Vercel Hobby preview schedule

While the project is being sampled on Vercel Hobby, the durable Product Binary
retry worker runs once daily at `0 16 * * *` (nominally midnight in
Asia/Manila). A paid and delivered order still attempts Product Binary
settlement immediately; this cron is the safety net for obligations that remain
pending or fail because of a temporary error.

The unpaid-order expiry worker is also temporarily scheduled once daily on
Hobby. Its 48-hour `payment_due_at` remains authoritative: late proof is
rejected immediately, while reserved stock is released by the next daily sweep.
At the same Pro cutover, change `/api/cron/expire-unpaid-orders` to
`0 * * * *` so automatic stock release occurs within one hour of expiry.

This daily schedule is temporary and is not the approved nationwide-production
capacity. The worker leases at most ten due obligations per invocation, so a
daily retry can delay recovery and accumulate a backlog. Before the public
production rollout, upgrade the Vercel project to Pro, restore `*/5 * * * *`,
deploy, verify the cron in Vercel, and force one safe staging retry to prove that
the job completes exactly once. Do not remove the durable job, lease,
idempotency, funding, or audit protections when changing only the schedule.

## Protected invariants

- A registration or upgrade PIN is usable only when it has exactly one fully
  paid issuance source.
- Active upgrades are database-enforced lower-to-higher in package price and
  Package Binary points, and their PIN price covers the incremental protected
  Direct Referral and Package Binary allocation.
- A normal product order cannot also be reused as a PIN-sale funding source.
- Registration and upgrade economics and released products are immutable after
  PIN issuance.
- Direct Referral is paid only for a new registration. Its event key and source
  PIN are unique. Every paid, retained, capped, ineligible, and Hiroma-root
  decision snapshots the locked sponsor package, Manila-day cap, and opening /
  closing counter in one immutable settlement event.
- Upgrade Direct Referral is recorded as retained income and is not credited to
  a reseller wallet.
- Package Binary and Product Binary can become spendable only after exact
  reserve consumption exists.
- Wallet balances move only through the append-only wallet ledger.
- Payout requests reserve source-backed funds, and release/disbursement requires
  the same payout's immutable reservation and allocation lineage. Requested,
  approved/rejected, and released states also require one matching append-only
  audit event with a database-authored lifecycle timestamp.
- Reseller deactivation is a sealed financial settlement: wallet balance must
  exactly equal unpaid source lots, every lot gets immutable forfeiture
  evidence, and the wallet debit, company retention, and audit must all commit.
- Product Binary delivery obligations use a durable job, atomic worker lease,
  bounded retry, and order-level idempotency.
- Member-ID sequences are permanent and are not recycled after user deletion.
  An append-only issuance/tombstone registry gates new user IDs and is seeded
  from both current users and preserved audit evidence.

## Before deployment

1. Take and verify a restorable database backup.
2. Put financial writes in a short maintenance window.
3. Run the migration on a production-sized staging clone first.
4. Resolve every migration preflight error; never delete or arbitrarily choose
   between duplicate historical commissions.
5. Configure a strong CRON_SECRET and confirm the Product Binary worker runs on
   schedule.
6. Use separate database roles: the migration role may own schema objects, but
   the production application role must not own the database, any application
   schema, protected tables, or protected financial functions; run DDL;
   disable triggers; or set `session_replication_role`.
7. With the owner/migration credential, revoke database `CREATE` and `TEMP`
   from both `PUBLIC` and the runtime role, revoke `CREATE` on every
   non-system schema from both, revoke direct `UPDATE`/`DELETE` on `wallets`
   from the runtime role, and remove any explicit runtime `EXECUTE` grant on a
   protected financial function. PostgreSQL grants database `TEMP` and new
   function `EXECUTE` to `PUBLIC` by default; leaving either grant in place can
   reopen a trigger-reuse bypass.
8. Set `FINANCIAL_RUNTIME_DATABASE_URL` to the **runtime application role** and
   run `npm run verify:financial-runtime-role`. A failure blocks deployment.
   Never point this check at the migration/owner credential.
9. Use PostgreSQL 15 or newer; PostgreSQL 17 is the tested production baseline.
   Every financial cutover migration and the runtime-role verification fail
   closed below the supported minimum.

Financial migrations `20260901170000` through `20260902155000` take their
required source/ledger locks in one fixed order and use an explicit transaction
to make each preflight, snapshot/backfill, and trigger installation one atomic
boundary. Deploy database migrations first while registration, PIN issuance,
upgrade, commission, payout, order-settlement, deactivation, and tree-placement
workers are drained. A lock timeout/deadlock is a safe failed deployment: keep
writes paused, investigate the holding session, and retry the unchanged
migration. Never disable a financial trigger to force cutover. The descendant
count rebuild walks the full ancestry graph and can approach quadratic work for
a pathologically chain-shaped tree, so measure its lock duration on a
production-sized clone before scheduling the maintenance window.

The Direct Referral settlement cutover also verifies that the historical
financial identity columns are native PostgreSQL UUIDs. A database created by
an old `prisma db push` workflow can contain TEXT drift even though the faithful
migration chain uses UUID. That preflight failure is a deployment stop: do not
cast production IDs ad hoc. Inventory every affected foreign key, prove every
value is a valid UUID, rehearse the coordinated conversion and rollback on a
production-sized clone, and preserve the reconciliation evidence.

Replication must use one explicitly reviewed topology. The recommended default
is to publish canonical business events only and rebuild derived financial
state through the normal application settlement paths. Do not replicate both
canonical and derived ledger rows while also firing financial side-effect
triggers. Ordinary triggers are safe only because the verified runtime role is
unable to enter replica mode; any replication service role needs a separate
table publication and reconciliation review before activation.

Migration `20260902146000_seal_binary_tree_placements` deliberately retires the
old `npm run reset:prelaunch` workflow because that script truncates the binary
tree and destroys financial genealogy. After this migration, reset through a
new isolated database/schema or restore a verified backup; never disable the
seal or truncate production financial history.

Legacy unused registration or upgrade PINs without authoritative historical
snapshots deliberately remain unreconciled. Cancel and reissue/refund them
through an audited operator process. Do not reconstruct their economics from
today's mutable package or product prices. The registration and upgrade
migrations abort and list the first 50 unresolved PIN/request IDs.

Migration `20260902155000_bind_upgrade_binary_reserve_lots` also refuses the
cutover if an upgrade-funded Package Binary reserve lot has no matching
immutable upgrade financial record. Reconcile every reported reserve-lot ID
from authoritative upgrade evidence before retrying; do not delete the lot or
invent an upgrade solely to satisfy the foreign key.

Every existing payout must also pass the payout-lifecycle preflight: exact
reservation, release/disbursement, source-lot allocation, reseller recipient,
reviewer evidence, canonical audit chain, transaction reference, and amount
must agree with its status. Canonical payout audit rows that reference no
payout also block cutover. The migrations abort and list the first 50
unresolved payout or audit IDs. Do not manufacture a closed payout's history
from its status; prepare a separately reviewed forward remediation from bank
records and immutable accounting evidence before retrying.

The application cannot discover a deleted printed Member ID that never reached
the current database or its audit log. Before enabling registrations, compare
`member_id_issuances` with backups, exports, and the printed-ID/QR master list.
Import every missing historical ID with evidence source `operator_reconciled`;
the insert raises the yearly high-water mark automatically. Any migration
collision naming two account IDs must be investigated and one current account
must receive a formally retired/reissued card through an audited remediation—
never choose an owner silently.

Product Binary migration `20260902152000_bind_product_binary_to_paid_orders`
quarantines the unused balance of legacy inventory-movement funding lots. It
does not rewrite or erase the original allocation/consumption history. New
reserve is created only from a paid, delivered Hiroma/Admin commerce order with
database-authored item eligibility, PU, company-cost, margin, payment, and
delivery snapshots. Historical delivered orders without those snapshots remain
`reconciliation_required`; unpaid delivered reseller orders remain
`waiting_payment`. Neither status is selected by the settlement worker and
neither can create spendable commission. Reconcile historical sources from
payment receipts and immutable accounting records—never from today's product
price, cost, eligibility, or PU configuration.

This migration takes `SHARE ROW EXCLUSIVE` locks on orders, items, Product
Binary jobs/events/funding, inventory movements, commissions, products, and
users while it quarantines legacy balances and installs the replacement
validators. Measure it on a production-sized clone and drain order/payment and
commission workers for the maintenance window. The migration also normalizes
`paid_at` and `delivered_at` at the database transition boundary; after
qualification those timestamps, order/item identity, settlement snapshots, and
funding provenance are immutable.

## Required post-deployment checks

The Admin Reserve Ledger must show:

- zero unreconciled wallets;
- zero unsupported positive wallet balance;
- zero liability deficit;
- zero funding shortfall;
- zero unreconciled registration/upgrade PINs and pending PIN requests;
- zero payout lifecycle mismatches;
- zero deactivation lifecycle mismatches and zero legacy deactivation events
  awaiting documented reconciliation;
- no overdue or repeatedly failed Product Binary settlement job.

Test one transaction for each path in staging:

- City and Branch registration;
- Starter to Silver, Starter to Gold, and Silver to Gold upgrade;
- duplicate request/retry of each event;
- concurrent PIN approval;
- concurrent payout requests;
- payout rejection, approval, and final release;
- reseller deactivation with a funded balance, a zero balance, an active payout
  (must be blocked), and an intentionally unreconciled wallet (must be blocked);
- delivered Product Binary order and forced retry.

Confirm that retries return the original financial result and never create a
second commission, wallet entry, reserve consumption, product release, or
payout.

## Operating controls

- Treat the protected Package Binary pool as funding for commissions that the
  system has actually accepted, not as proof that the compensation plan is
  economically solvent forever. Registration/upgrade volume propagates to
  multiple ancestors, so one source event can trigger more than one pair.
  Stress-test balanced and deep trees at slow and burst growth, all package
  mixes, daily caps, carryover, upgrades, refunds, and attrition; set a
  board-approved minimum cash/reserve headroom and controlled sales stop before
  nationwide expansion.
- Upgrade Direct Referral retained income remains company income and is not
  silently added to the Package Binary reserve. If treasury later dedicates
  retained income or product margin to that reserve, record it as a separate,
  approved, append-only funding source rather than changing historical PIN
  allocations.
- Reconcile the wallet ledger, commission payable lots, bank/cash balance, PIN
  sales, inventory, and released payouts daily.
- Alert immediately on any non-zero reconciliation discrepancy, funding
  shortfall, negative reserve, failed financial transaction, or Product Binary
  job older than five minutes.
- Restrict database credentials and migration permissions to authorized
  operators. Application users must never receive direct database access, and
  the application connection must use the non-owner runtime role described
  above.
- Back up daily, test restoration regularly, rotate secrets, and retain
  append-only audit evidence according to the accounting/compliance policy.
- Review commission rates, caps, product margins, refund exposure, tax, and
  actual liquidity with a Philippine accountant and qualified legal/compliance
  counsel before nationwide expansion.

## Failure behavior

Package configuration and PIN issuance fail before sale when allocations or
product economics are underfunded. Registration/upgrade and commission
settlement run atomically: a shortfall cannot create spendable commission or
partial points. Product Binary obligations already attached to a completed
commerce order stay queued and visibly marked rewards_pending; they retry
without duplicating rewards. Payouts cannot be approved or released unless
their full source allocation and reservation lineage are present. Deactivation
cannot erase a wallet while leaving its source liabilities behind; any mismatch
blocks only that deactivation until it is reconciled.
