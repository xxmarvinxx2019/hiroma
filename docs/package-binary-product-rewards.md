# Package Binary product rewards

Admin Settings → **Package Binary product rewards** controls whether every Nth eligible pair replaces cash with one bottle. The initial interval is 5, and rewards remain disabled until the owner chooses the bottle and enables the policy with their Security PIN. Supported intervals: 2–1000. Changes are audited and serialized with settlement.

## Entitlement rules

Package Binary now uses [two daily sessions](package-binary-two-sessions.md): the approved rollout sets all packages to 5 eligible pairs before 1 PM and 5 from 1 PM, Philippine time. After the session cap, new incoming points on either leg are flushed, including unmatched volume. Existing valid carryover is preserved. This replaces the previous matched-pairs-only cap overflow behavior for new settlement events.

- An active recipient's pairs within the daily cap are eligible. Cash pairs and product pairs both use that cap. Flashout and inactive pairs do not advance reward progress.
- At interval 5, eligible ordinals 5, 10, 15, etc. earn one bottle each instead of their cash commission. Batched events may earn multiple bottles. Product Binary is unaffected.
- The counter continues across days, package changes, registrations and upgrades. Historical pairs before activation and eligible pairs earned while disabled are excluded.
- Changing interval preserves the counter. For example, changing from 5 to 6 after ordinal 5 makes ordinal 6 the next bottle; after ordinal 10, the next bottle is ordinal 12. Earlier rewards remain untouched. The UI explicitly describes this behavior.
- Changing the configured SKU affects future entitlements only. Every earned credit snapshots its SKU, product name, company unit cost and quantity. One bottle does not mean cash or products equivalent to the pair's cash value.
- Bottle credits never create a commission, withdrawable wallet credit, order, PU or further binary reward. The cash portion continues through the existing protected commission/financial ledger. The database independently verifies the cash/product partition and eligible counter.
- The reward ledger is append-only and unique per pair event. It is populated by a database trigger from the immutable pair entitlement, not a client request. The standard source-event uniqueness and transaction locks protect retries and simultaneous settlement.

`binary_pair_events.payable_pairs` retains its historical meaning of active within-cap eligible pairs, now including product pairs. Monetary cash pairs are `payable_pairs - product_reward_pairs`; only those pairs contribute to the commission amount and commission points. Reports expose the product portion separately.

## Reseller display and onsite claiming

The reseller dashboard has a **Product Rewards** card with earned, claimed and unclaimed quantities, SKU breakdown and progress to the next bottle. It is entirely hidden when earning is disabled. Existing earned credits are preserved and can still be released onsite by an authorized outlet even when new reward earning is disabled.

Branch/city POS has a separate **Claim Product Rewards** button. It requires internet, the cashier's own open shift, an enrolled active terminal and no pending local offline sales. It does not alter the normal sales cart or pricing. The modal offers **Scan Member ID**, verifies an active reseller, shows unclaimed quantities and outlet available stock, then requests the reseller's existing six-digit Security PIN. A USB scanner/Member ID field is provided if the camera is unavailable. The reseller enters the PIN themselves. PIN checks use the existing persistent attempt limits/lockout; a PIN that is not configured is rejected.

Each scan issues a random hashed single-use proof valid for five minutes, bound to the outlet, cashier, reseller, terminal and shift. These proofs are stored separately from normal-sale scan proofs. Each release is one SKU and 1–100 bottles. The server ignores prices supplied by clients, validates current stock and entitlements, and serializes claim allocation for the reseller across all outlets.

One database transaction inserts the release, consumes individual reward units FIFO, decrements unreserved outlet inventory, adds received bottles to the reseller's inventory, consumes the scan proof, writes stock-out/stock-in audit events, and records the required audit log. Any failure rolls this back together. A unique `(reward_id, unit_number)` constraint prevents the same earned bottle being claimed at another outlet. An immutable release reference and client request ID support safe retries; a changed payload cannot reuse that ID. Uncertain network outcomes keep the modal on the same release reference for retry.

The success acknowledgment shows the release reference, product, quantity, outlet, cashier and date. It is not a paid sales receipt. Claims create no order, cash collection, commission, funding lot or binary PU. No cash reimbursement, claim reversal, courier delivery or return workflow is added. Outlet acquisition cost is recorded on its inventory-out event; this is separate from the original company-cost snapshot on the earned credit. Physical replacement balances for independent distributors and internal replenishment for Hiroma-owned branches are handled by the [Reward Stock Replacement workflow](reward-stock-replacements.md).

### Transaction history

The reseller card has **View transaction history**. Admin Settings shows the same milestone history below the reward policy, including while new rewards are disabled. Both views show the original earned date in Asia/Manila, qualifying pair number, snapshotted interval and product, one bottle per milestone, and a shared unique reference. Each entry can reveal its original Package Binary pair transaction ID and source kind. Claimed units additionally show their immutable release reference, timestamp, outlet and cashier; other units are marked unclaimed.

History reads the existing immutable reward ledger; it does not issue new credits. A batch earning two bottles expands into two display entries, e.g. pair #5 and pair #10. Each reference is `PR-<reward-ledger-UUID>:<eligible-pair-ordinal>`. The rows share their original pair transaction but have distinct stable references. Later rule or price changes do not relabel historical milestones.

The reseller endpoint uses the authenticated reseller ID and omits company costs and other member identities. When the feature is disabled, neither the reseller card nor its history is shown; the history endpoint returns no records. Owner-only admin history includes the reseller identity and snapshotted company cost, and supports searching by name, username or reward reference. History is paginated (20 entries by default, maximum 50 per request) with deterministic ordering. All reads use a repeatable-read transaction and private/no-store responses.

Admin settings show total bottle credits and recorded company cost separately from cash commissions. Earning a credit does not reserve stock or earmark cash. Physical inventory is deducted only when an onsite release commits.

## Deployment

Apply `20261028090000_package_binary_product_rewards` using the deployment database role before deploying code that queries the new columns/table. Use a maintenance window for registration/upgrade settlement during the migration/code transition.

On 28 October 2026, the missing Package Binary point-expiry and product-reward migrations were applied to the database configured for the local app to resolve the settings errors. Both ran together in an atomic transaction, with their original-file checksums recorded in Prisma migration history. The other pending financial-rule migrations were not applied. Existing unmatched point balances were preserved and reconciled to the new expiry lots. Product rewards remain disabled until the owner configures and saves the policy. This is not a claim that any separate production database was migrated.

On 29 October 2026, `20261029090000_product_reward_claims` was applied to that configured database after isolated integration tests passed. This added the claim/proof/allocation tables and protected fulfillment triggers, without issuing claims or moving live stock. Apply this migration before deploying the claiming UI/history code to another environment. The application role needs SELECT/INSERT on claim proofs and claims, and SELECT on allocations. It must not have direct UPDATE/DELETE on these ledgers, DML on allocations, ownership, TRIGGER, TRUNCATE or execute permission on internal claim trigger functions. The runtime verifier includes the new tables and owner functions.

The migration preserves all prior entitlement checks and updates the cash amount/points formulas. It does not alter Product Binary or rewrite past rewards. The new internal credit function is SECURITY DEFINER with a fixed search path and no PUBLIC execute permission. Grant the application role SELECT on `package_binary_product_rewards`; it needs no direct DML permission on that table. Continue prohibiting runtime ownership, TRIGGER and TRUNCATE privileges. The financial runtime verifier includes the new ledger and internal function.

After migration and app deployment, the owner selects an active reward bottle with positive company cost, keeps interval 5 (or chooses another interval), and enables the rule. An unavailable/deactivated reward SKU blocks new earning while enabled rather than silently substituting cash or another bottle. Previously earned bottles retain their SKU and can be claimed from matching available stock.

## Validation

- `node --import tsx --test tests/packageBinaryReward.test.ts`: milestone and batch splitting, interval changes, disable/re-enable semantics, policy validation, safe counter bounds, and an independent pair-by-pair oracle.
- `node --import tsx --test tests/packageBinaryReward.integration.test.ts`: applies the real migration to a disposable PostgreSQL schema inside a rollback-only transaction; checks cash entitlements, bottle-only events, batches, changed intervals, snapshots, cap/inactive exclusion, forged progress/SKU rejection, append-only history and unauthorized duplicate credit insertion. It does not apply the production migration.
- The integration fixture uses the real entitlement validators and reward triggers, but does not represent a full POS registration, wallet/payout or physical fulfillment test.
- The same integration test executes the history SQL against earned fixture records: batch expansion, unique shared references, historical interval/cost snapshots, account isolation, absence of company costs in reseller data, exact-reference/name search, literal wildcard handling, page boundaries and unchanged credit totals after reading. `tests/productRewardHistory.test.ts` verifies pagination input bounds.
- `tests/productRewardClaims.integration.test.ts` applies the actual claiming migration in disposable schemas. It verifies atomic stock transfers and audits, safe replay and changed-request rejection, per-unit history, expired/bound/consumed proofs, reserved stock, excessive quantities, another member's entitlements, closed shifts, unauthorized staff and successful authorized cashier releases. A two-connection race at separate outlets proves only one release commits for the final earned bottle. Fixtures are rolled back or dropped; no live reward is claimed by these tests.
