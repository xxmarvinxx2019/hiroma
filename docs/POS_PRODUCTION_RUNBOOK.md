# POS production deployment and recovery runbook

This runbook is the release gate for the cashier POS. A green build alone is not permission to deploy.

## Before deployment

1. Confirm the target commit and review every Prisma migration included in it.
2. Create and verify a restorable production database backup using the hosting provider's supported backup process.
3. Record the current production commit, deployment URL, and migration version for rollback.
4. Confirm required secrets are present in the production environment without copying secret values into logs or tickets.
5. Run TypeScript, Prisma validation, lint, the full automated suite, and a production build.
6. On a real Windows cashier device, verify install, login, open shift, sale, print, close shift, and restart behavior.

## Existing database migration baseline gate

An existing non-empty database without a `_prisma_migrations` history is a hard
release stop (`P3005`). Do not run `migrate resolve`, edit production tables, or
mark migrations applied merely to silence the error.

1. Create a provider-supported backup and restore it into an isolated staging database.
2. Run `npx prisma migrate status` against the staging clone and preserve the output.
3. Compare every migration in `prisma/migrations` with the clone's real schema and data constraints.
4. Have the responsible database reviewer record which migrations are already represented and which still need application.
5. Only after that review, use Prisma's documented baseline procedure on the staging clone and rerun `npx prisma migrate deploy` twice; the second run must be a no-op.
6. Exercise login, branch reports, deposit submission/confirmation/review, POS sale, offline sync, and shift close against the baselined clone.
7. Repeat the approved, recorded procedure in production during a controlled maintenance window with rollback ownership assigned.

Production is **no-go** while `prisma migrate deploy` returns `P3005`, the baseline
mapping is undocumented, or the restored clone has not passed the workflow checks.

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

Use a dedicated, non-administrator Windows kiosk account for each physical POS.
Enable full-disk encryption, automatic screen lock, OS/browser updates, and device
inventory controls. Offline queue payloads are encrypted with a non-exportable
terminal-scoped browser key, but a logged-in compromised browser session remains a
trusted endpoint and must be handled through device controls.

Production is **no-go** until the physical printer, cash drawer, offline/reconnect, and Windows restart checks pass on the actual cashier hardware.
