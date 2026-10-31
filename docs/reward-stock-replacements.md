# Reward stock replacement and branch replenishment

Every physically claimed reward bottle creates exactly one non-cash replacement unit, linked by a unique foreign key to its original claim allocation. This happens in the same transaction as the customer's claim; it is not another reseller reward and does not increase inventory immediately.

The outlet type at creation determines the treatment:

- `city`: independent distributor stock replacement. The current holder can be replenished by an active provincial distributor in its province/region or regional distributor in its region, or directly by an active Hiroma admin stock account.
- `branch`: Hiroma-owned internal replenishment. Only a Hiroma admin stock account can supply it. Provincial/regional distributors cannot turn an internal branch requirement into a personal replacement entitlement.

## Physical flow

All four Inventory pages (city/branch, provincial, regional, admin) include **Reward Stock Replacement**. Pending quantities are generated automatically from reward releases; no manual balance creation is exposed. Authorized suppliers see downstream pending stock they can supply, their available unreserved stock, a quantity field and **Dispatch**. Each dispatch covers one recipient, SKU and type, up to 100 bottles. Pending groups are capped at 200 with account/product search, shipment history is paginated, and the latest 50 original units are shown for tracing.

Dispatch atomically allocates pending units, deducts available supplier stock, and records an immutable shipment plus inventory-out audit event. The recipient's stock remains unchanged while bottles are in transit. A supplier gains no upstream replacement balance just by dispatching.

The receiving account must select **Confirm received** after physically counting all bottles in good condition. This atomically adds stock to that account, records the receipt and inventory-in audit event, and updates the same original units:

- Independent provincial/regional supplier: move the units to that supplier's pending balance, preserving original claim identity and incrementing the confirmed replacement step. No extra units are created.
- Hiroma admin supplier: close those units permanently. This also closes company-owned branch replenishment; no personal compensation balance is created for the branch.

Example: a city releases two reward bottles. Provincial dispatches two, reducing its own stock. Once city confirms receipt, city stock is restored and the same two units move to provincial. Regional can replace provincial; after provincial confirms, those same units move to regional. Hiroma's final supply closes the two units after the receiving distributor confirms receipt. There are always two original units, never six credits.

An active Hiroma admin may also replace an independent city/provincial directly, skipping intermediate suppliers. Independent suppliers must be valid ancestors, not unrelated accounts. Cyclic profile links are bounded during hierarchy traversal.

## Records and protections

- Original `RB-…` replacement reference links through claim allocation to `RC-…` customer release. Dispatches use `RS-…`; receipt confirmations use `RR-…`.
- A unique claim-allocation key prevents duplicate root balances. Dispatch items are unique by original unit and replacement cycle. In-transit units cannot be dispatched again.
- Stock mutations and unit transitions run inside fixed-search-path owner trigger functions with no PUBLIC execute privilege. Original unit fields cannot be edited; shipments, allocations and receipts are immutable. Runtime accounts must not own these objects or have TRIGGER/TRUNCATE privileges.
- Requests use a unique client dispatch reference. The API serializes it and returns an existing matching shipment on retry; a changed payload cannot reuse that reference. Receipt confirmation locks the shipment and is unique per dispatch. Repeated confirmations return the existing receipt without adding stock again.
- Role and fresh inventory permission checks apply to every request. Cashier-only and reseller accounts cannot access this workspace. Admin inventory-view staff can read, but need inventory-manage permission to dispatch/receive. Distributor staff require inventory permission. Receipt confirmation belongs to the recipient, not its supplier or a viewing admin.
- Financial audit logs are written inside the same transaction. No sale order, cash commission, binary PU, registration funding or money-wallet credit is generated. Inventory cost snapshots are movement values, not new sales revenue.

This workflow confirms full good-condition deliveries. Partial, damaged, missing or returned shipments must not be confirmed as fully received. No automated discrepancy, cancellation, reversal, cash reimbursement or alternate company-depot ownership workflow is included. In-transit units remain blocked until the delivery can be correctly resolved; do not create a second dispatch for the same physical delivery.

## Migration and validation

On 30 October 2026, the replacement migration was applied to the database configured for the local app. There were no existing released reward bottles to backfill. No actual replacement shipment or inventory transfer was issued during setup, and other pending compensation migrations were left unchanged.

`20261030090000_reward_stock_replacements` adds the ledger and triggers. It locks claim writers while backfilling existing genuine claim allocations exactly once. Historical outlet classification is explicitly marked `legacy_current_profile`, since old claims did not snapshot ownership type; admin should review that classification before replenishment. Missing outlet profiles block the migration instead of inventing ownership. New releases snapshot classification when earned stock is physically released.

The application needs SELECT on the new ledgers, INSERT on dispatches/receipts, and execute access to the two read-only authorization helpers. It does not need DML on replacement units or dispatch items, or execute access to the internal mutation triggers. The financial runtime verifier includes the new tables and owner functions.

Tests use disposable PostgreSQL schemas and the real migrations. They cover the whole multi-level chain, direct Hiroma replacement, company-branch treatment, partial replenishment quantities, stock reserved for orders, authorized hierarchy, account permissions, immutable references, unchanged original unit count, repeated receipts, and two concurrent suppliers/receivers competing for the same bottle/shipment. These tests do not replenish real outlet stock.


## Combining free replacements with a new paid order

City, provincial and regional Place New Order forms offer **Include free replacement bottles in this shipment**. The buyer selects whole-bottle quantities from their own unused credits, up to 100 per product/kind. The selected supplier must be the same as the paid order and must satisfy the existing upstream authorization; company branches can receive internal replenishment only from Hiroma. Supplier routing follows provincial territory → regional territory → Hiroma; this change does not add a supplier chooser.

The paid order must contain at least one paid item. Free lines are stored separately in `order_replacement_requests` and `order_replacement_units`; they never become paid order items, sales revenue, commission, binary PU or money-wallet credit. The order details show paid items and free lines separately, under the same order reference. No second shipping charge is generated by the replacement feature. Courier booking and shipping fees remain the existing order workflow.

Submitting the order reserves the paid stock, free stock and original credit units in one transaction. Another order or manual dispatch cannot take reserved credits. If either paid stock, free stock or credits are insufficient, the entire checkout rolls back. Cancellation (including automated expiry) releases the free stock and credits through the order status trigger, alongside the existing release of paid stock. A rejected action cannot leave a partial reservation.

This uses the existing inventory lifecycle: `processing` is preparation and retains reservations. At `delivered`, the database deducts and records the free stock dispatch linked to the paid order, while existing code finalizes paid stock. It does not claim to track an earlier courier handoff. The recipient confirms the free bottles separately, either in expanded order details or Reward Stock Replacement shipment history. Only that physical-receipt confirmation adds the free bottles to the recipient inventory and transfers/settles the same original obligation. Repeated status updates or receipt retries cannot duplicate stock. Damaged or incomplete deliveries must not be confirmed; reconciliation remains manual.

Hiroma stock counts remain private: replacement options expose only availability status for Hiroma, plus the buyer's own credit count. Error messages do not reveal Hiroma's available quantity. Numeric availability remains visible for distributor suppliers. Inventory, cost and audit records are retained unchanged.

Migration `20261031090000_combined_order_replacements` adds protected request/allocation history, stock/credit reservation, cancellation and delivery triggers, and prevents manual dispatch from consuming reserved units. It was applied to the configured app database without creating orders or moving stock. Standalone replacement-only requests and adding replacements to an already-created order remain outside this flow.


Territory alignment migration `20261031110000_align_supplier_territories` allows matching territory suppliers to fulfill replacement credits even without a parent link, while excluding suppliers from other territories. Paid ordering still chooses Provincial before Regional before Hiroma; inadequate stock blocks checkout rather than selecting another supplier. Branch internal replenishment remains Hiroma-only.
