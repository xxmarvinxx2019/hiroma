# Hypothetical three-bottle pairing — 11 October 2026

Rule modeled: 3 PU left + 3 PU right = one PHP 5 pair, with one PU per bottle. Production compensation code was not changed.

Reproduce: `node --import tsx scripts/stress-product-binary.ts --three-per-leg --offline`. All 100,000 seeded rule checks passed. Raw results: `docs/product-binary-three-bottle-results.json`.

The same annual balanced scenario as the two-bottle review was used: 5,000 active members, two bottles per member every 30 days, staggered purchases over 365 days, 121,670 bottles total, zero opening carryover, and unchanged 20/40/100 daily caps. Holding purchase quantities constant isolates the pairing-rule effect. No PU reaches its 12-month expiry in this window.

| Plan | Two per side: payout/bottle | Three per side: payout/bottle | Three per side: total payout | Reserve remainder at PHP 20/bottle |
|---|---:|---:|---:|---:|
| Starter | PHP 11.06 | PHP 7.76 | PHP 944,085 | PHP 1,489,315 |
| Silver | PHP 11.94 | PHP 8.15 | PHP 991,125 | PHP 1,442,275 |
| Gold | PHP 12.36 | PHP 8.23 | PHP 1,001,135 | PHP 1,432,265 |

At PHP 20 genuine funding per bottle, cumulative reserve never became negative in these scenarios. At PHP 5 per bottle, intended payouts exceeded cumulative funding; ending shortfalls were PHP 335,735 Starter, PHP 382,775 Silver, and PHP 392,785 Gold. Starter's worst intermediate shortfall was PHP 336,040. The model continues counting intended entitlements after hypothetical shortfalls, while actual funded settlement should roll back and queue rewards.

For equal matched volume before caps and rounding, increasing the requirement from four total bottles to six reduces binary payout per bottle by one third. Actual reductions in the annual scenarios differ because caps and carryover affect payout timing. The results indicate improved compensation funding headroom, not proven company profitability. Realized company revenue less product cost, distributor margins, all other commissions, operations, taxes, refunds, and this payout determines profit.

The previously observed connected reserve remains a separate concern: PHP 0 usable reserve was found in the earlier read-only audit. This hypothetical offline run does not re-audit or repair it. Increasing the pairing requirement does not create funding or reconcile historical records.
