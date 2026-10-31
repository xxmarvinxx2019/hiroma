# Product Binary stress review — 11 October 2026

The current workspace implements **2 bottles left + 2 bottles right = 1 pair = PHP 5**, because all inspected eligible products currently assign one PU per bottle. The processor uses two PU per leg, not bottle quantities directly; changing a product's PU changes that equivalence.

**Assessment: the modeled economics have headroom with PHP 20 of genuine reserve per bottle, but the connected database is not financially ready for new payable pairs. This is not a certification of overall business profitability or a production concurrency benchmark.**

## Effective rules

| Package | Pairs per Manila day | Maximum payable per day |
|---|---:|---:|
| Starter | 20 | PHP 100 |
| Silver | 40 | PHP 200 |
| Gold | 100 | PHP 500 |

Every eligible ancestor can pair; there is no ancestor depth limit in the processor. Daily overflow and inactive pairs consume matched PU and become retained company evidence, without a spendable wallet credit. Rank does not increase the PHP 5 rate. Unmatched PU expires after 12 months under the connected setting.

The funding migration allocates `min(realized eligible company gross margin, eligible bottles × PHP 20)` from exact paid-delivered Admin orders. Distributor resale creates PU obligations but does not create fresh company reserve. Therefore PHP 20 is a maximum allocation, not guaranteed funding from every reseller order. Stock already funded upstream must not be counted as fresh funding again on resale.

## Stress results

The reproducible script is `scripts/stress-product-binary.ts`; run `node --import tsx scripts/stress-product-binary.ts`. Its database inspection is inside an explicitly read-only repeatable-read transaction. No order, wallet, or compensation configuration was changed.

100,000 seeded rule cases passed: pair-volume consumption, cap conservation, inactive exclusion, and cap bounds. Forty existing tests passed covering plan rates, paid-source snapshots, funding rejection, idempotency, durable retries, quarterly rules, and expiry setting validation. Many existing checks inspect code or SQL; they do not execute a complete database settlement under concurrency.

Annual balanced scenario: 5,000 members, every member buys two bottles every 30 days, purchases staggered by member ID across 365 days, active recipients, no opening carryover. Total sales: 121,670 bottles. No PU reaches its 12-month expiry during this window. Each package is modeled separately for all recipients.

| Package | Member payouts | Payout per bottle | Reserve if genuinely funded at PHP 20/bottle | Reserve after payouts |
|---|---:|---:|---:|---:|
| Starter | PHP 1,345,685 | PHP 11.06 | PHP 2,433,400 | PHP 1,087,715 |
| Silver | PHP 1,452,690 | PHP 11.94 | PHP 2,433,400 | PHP 980,710 |
| Gold | PHP 1,504,205 | PHP 12.36 | PHP 2,433,400 | PHP 929,195 |

The script also checks cumulative funding versus cumulative intended payout at each ancestor event. None of these annual scenarios goes negative at PHP 20 funding per bottle. At PHP 5 funding per bottle, the balanced scenario ends short by PHP 737,335 Starter, PHP 844,340 Silver, and PHP 895,855 Gold. It models intended entitlements even if hypothetical funds run out; actual protected settlement should roll back and retry on a shortfall. Operating costs, tax, refunds, and other compensation are excluded. The reserve remainder is not net profit.

A 1,000-member comb tree reaches depth 500 but pays only PHP 30,445 from 24,340 bottles (PHP 1.25 per bottle) under the same annual cadence, while accumulating 6,072,380 unmatched PU across positions. Depth alone does not predict payouts; branching, purchase balance, and carryover matter. Aggregate propagated PU is not a count of unique bottles.

Same-day balanced bursts were modeled through 262,144 leaf buyers (524,288 bottles), each leaf buying two bottles. At depth 18, payouts per bottle are PHP 7.81 Starter, PHP 9.06 Silver, and PHP 10.70 Gold. Flashout reduces these bursts substantially.

For a fully balanced leaf-only tree of depth D before caps/expiry, cumulative pair exposure is `PHP 1.25 × D` per bottle: PHP 15 at depth 12, PHP 20 at depth 16, and PHP 21.25 at depth 17. This is theoretical exposure, not a payable forecast: daily caps, scheduling, and expiry may prevent realizing it. It shows why a fixed rate and fixed per-bottle reserve alone do not establish safety at arbitrary scale. The burst results do not establish a global bound for every possible purchase schedule.

## Connected database findings

- Available Product Binary reserve: **PHP 0**. The apparent PHP 1,000 historical allocation is quarantined (`legacy_movement_quarantined`) and cannot fund commissions. The other funding lot has zero allocation and requires legacy order snapshot reconciliation.
- One settlement job requires reconciliation. No Product Binary pair events or member Product Binary commissions currently exist, so historical production payouts cannot validate the simulations.
- The database stores package cap 50 for all packages and rank pair incomes of PHP 10–40. The current processor intentionally ignores these monetary settings and uses the hard-coded PHP 5 rate and 20/40/100 caps. Editing those stored values does not change this processor's entitlement.
- The paid-order funding and funding-consumption routines are installed, and relevant paid-source/funding/PU-expiry migrations are recorded as applied. This inspection does not verify every deployed application version or trigger definition.

## Required follow-through

Reconcile the quarantined legacy funding and order from genuine payment and item evidence; never turn quarantined amounts into usable funds just to make an audit pass. Verify actual usable company funding exists before accepting payable pair obligations. Align admin configuration displays with the rules the processor actually uses. Then exercise concurrent deliveries, duplicate worker attempts, insufficient funding, and delayed settlement in an isolated staging database using the same deployed revision.

The current implementation uses settlement time for the Manila-day cap, while PU expiry uses the original qualification time. Backlogs settled together can therefore compete for the same day's cap; a delayed settlement does not renew expired PU. Include that behavior in staging acceptance checks.
