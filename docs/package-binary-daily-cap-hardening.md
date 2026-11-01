# Package Binary daily cap hardening

The allowance is now recorded by member and Manila pairing date in `binary_daily_cap_usage`. Settlement reads this record under the existing member lock. Cash pairs, product pairs, and inactive within-cap pairs consume allowance; cap flashouts do not. Package limits and fifth-pair product rules are unchanged.

The pairing date continues to use the database transaction start time in Manila. A delayed transaction for yesterday cannot erase today's usage or move the profile display cache backward. The profile daily counter is a display cache, not the authority for granting more pairs.

The database validates each immutable pair event, accumulates its usage in the same transaction, and checks closing points and usage before commit. A failed transaction rolls back the event, usage, rewards, and commissions together. Direct usage edits and truncation are rejected by triggers. Runtime credentials must remain separate from the database owner; the financial runtime-role verification script includes the new table and internal accumulator function.

Migration `20261031150000_harden_package_binary_daily_caps` preserves history. It backfills recorded within-cap usage and takes the greater existing dated profile counter where necessary. It refuses undated positive counters so an operator can reconcile them rather than silently grant allowance. It does not rewrite commissions or earned bottles.

Quiesce registration and upgrade settlement during migration and application rollout. Apply the migration before enabling the updated application, which requires the new table. Verify runtime-role permissions with the existing financial runtime-role script using the intended runtime connection.

Integration tests use disposable schemas and production validators with a controlled test clock. They cover concurrent events, the final remaining slot, out-of-order midnight transactions, rollback, cache tampering, protected usage records, cap changes, disabled caps, inactivity, and historical backfill. These tests establish the tested settlement behavior; they are not a throughput benchmark or an assessment of compensation-plan profitability.
