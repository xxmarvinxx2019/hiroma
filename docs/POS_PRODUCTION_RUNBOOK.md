# POS production deployment and recovery runbook

This runbook is the release gate for the cashier POS. A green build alone is not permission to deploy.

## Before deployment

1. Confirm the target commit and review every Prisma migration included in it.
2. Create and verify a restorable production database backup using the hosting provider's supported backup process.
3. Record the current production commit, deployment URL, and migration version for rollback.
4. Confirm required secrets are present in the production environment without copying secret values into logs or tickets.
5. Run TypeScript, Prisma validation, lint, the full automated suite, and a production build.
6. On a real Windows cashier device, verify install, login, open shift, sale, print, close shift, and restart behavior.

## Controlled release

1. Apply reviewed migrations through the normal deployment pipeline; never edit production tables manually.
2. Deploy one immutable commit.
3. Smoke-test owner and cashier authorization, terminal bootstrap, receipt numbering, cash and non-cash sale, offline queue/reconnect, refund approval, and shift closing.
4. Confirm a disabled POS terminal receives HTTP 403 and cannot silently reactivate itself.
5. Monitor application errors, failed sync events, duplicate/idempotency conflicts, authentication failures, and database saturation.

## Rollback

1. Stop further rollout when a security, data-integrity, duplicate-transaction, or migration error appears.
2. Roll the application back to the recorded known-good commit.
3. Do not reverse a data migration blindly. Follow the reviewed migration-specific recovery plan and restore the verified backup only when necessary.
4. Preserve logs and audit records, reconcile affected receipts and shifts, and document the incident before retrying.

## Mandatory physical offline test

1. Open a shift online and complete a baseline sale.
2. Disconnect the network and complete an allowed offline cash sale.
3. Close and reopen the installed PWA while offline; confirm the queued receipt and permanent reference remain intact.
4. Restore the network and run Sync now; confirm one server receipt, no duplicate, and a synced status.
5. Restart Windows and repeat login/bootstrap. Confirm disabled terminals stay blocked and authorized terminals recover normally.

Production is **no-go** until the physical printer, cash drawer, offline/reconnect, and Windows restart checks pass on the actual cashier hardware.
