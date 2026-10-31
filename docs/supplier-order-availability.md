# Supplier stock availability during ordering

City, provincial and regional **Place New Order** forms now show available quantities for the supplier named on the form. The catalog and checkout share one supplier resolver, using the provincial territory, regional territory and Hiroma fallback routing. This does not introduce an arbitrary supplier browser or a new supplier chooser.

Availability is `max(0, on-hand - reserved)` for that supplier only. Active visible products with zero available stock remain listed as out of stock; products with no inventory row at that supplier also have zero availability. Hidden/inactive products are excluded. The catalog returns product identity, buyer-tier selling price and available quantity; it does not disclose raw stock reservations, company cost or another supplier's inventory.

The forms refresh stock when opened, on window focus, every 30 seconds, and through **Refresh stock**. Add/quantity controls cannot exceed available quantities, and Place Order is disabled while availability is loading, unavailable or below the cart quantities. Refreshing preserves selected items so changed quantities can be corrected. Cart prices display the refreshed catalog prices. Snapshot availability is not a guarantee: the server checks and reserves current stock at submission.

The client sends the displayed supplier ID on catalog and checkout requests. A changed or unrelated supplier is rejected rather than silently switching accounts. Checkout re-resolves the supplier inside the reservation transaction. Each line is rechecked against available stock; stock reservation and order creation remain atomic. Failed or competing orders cannot leave partial reservations or oversell the same final units. Existing order cancellation/delivery paths continue releasing/finalizing reservations.

The city walk-in product listing also subtracts reservations from its own available stock. Other non-ordering product catalogs retain their existing behavior.

No schema migration, live stock reservation or real order was created by this change. Integration tests use disposable schemas and verify availability calculations, out-of-stock visibility, per-supplier isolation, private field omission, changed-supplier rejection, rollback of multi-item reservations, and two competing orders for the same last units.

Normal purchase orders can now include unused replacement credits through the opt-in combined-shipment picker. See `reward-stock-replacements.md`. Standalone outlet-initiated replacement requests and attaching credits to an already-created order are not implemented.

## Hiroma stock privacy

When the resolved supplier is Hiroma/Admin, the catalog returns `is_available` and `available_quantity: null`. Distributor forms show green Available or red Not available. No numeric maximum is placed on the quantity input, and checkout errors do not reveal the available quantity. Stock is still checked and reserved atomically. Other distributor suppliers retain numeric availability. This is access control for distributor-facing stock information, not a change to inventory or audit records. Acceptance/rejection of different quantities can still allow availability to be inferred; status-only display does not prevent that inference.


## Territory routing alignment

City orders go to the active Provincial in their province (and matching region), otherwise the active Regional in their region, otherwise Hiroma. Provincial orders go to their Regional or Hiroma; Regional orders go to Hiroma. Both the user and distributor profile must be active. Missing/inactive suppliers trigger territory fallback; low stock does not change the supplier. A stale parent link cannot override territory routing. Catalog, checkout and checkout's transactional recheck share this resolver.

Replacement eligibility uses matching province/region rather than requiring a saved parent chain. An eligible territory supplier can therefore supply paid and free lines even when `parent_dist_id` is absent. Hiroma remains authorized directly, and snapshotted branch internal replenishment remains Hiroma-only. The same original replacement unit still transfers/settles through the protected receipt ledger.

Migration `20261031110000_align_supplier_territories` adds database uniqueness for one active Regional per region, Provincial per province, and City/Hiroma Branch per city/municipality. Existing duplicate active territories stop migration instead of being silently reassigned. New/changed parent assignments must match level and province/region; parent location edits cannot strand active children. Admin activation updates user status and profile activation together in one transaction, so a territory conflict cannot leave half an activation saved. Parent reassignment, missing territory and duplicate territory failures return actionable messages.
