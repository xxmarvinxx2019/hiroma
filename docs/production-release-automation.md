# HIROMA production release automation

This repository includes an approval-gated production financial attestation
workflow at `.github/workflows/production-financial-attestation.yml`. It is
intentionally inactive until the repository owner finishes the one-time GitHub,
database-role, backup, and Vercel configuration below. Adding the workflow does
not migrate or deploy production by itself.

## Intended release sequence

1. A pull request is reviewed and merged into `main`.
   The `Database migration review` check tells reviewers whether migration files
   were added and rejects modification or deletion of existing migration history.
2. Vercel builds the merged commit, but does not promote it to the production
   domains while its required deployment check is pending.
3. GitHub pauses the `Production financial attestation` job at the protected
   `production` environment.
4. An authorized reviewer selects **Review deployments**, chooses
   `production`, and selects **Approve and deploy**.
5. GitHub verifies the exact `main` commit, runs the complete test suite, validates
   Prisma, and builds without production credentials.
6. In `deploy` mode, GitHub requires a backup reference and runs
   `prisma migrate deploy` using the owner connection. In both modes it then runs
   `prisma migrate status`.
7. GitHub proves that the owner and runtime connections target the approved
   database using distinct roles, verifies runtime least privilege, reconciles
   binary accounting, and evaluates the reserve-admission policy.
8. GitHub publishes a redacted, commit-bound attestation artifact. The backup
   reference is represented only by a SHA-256 digest.
9. Only a successful `Production financial attestation` check permits Vercel to
   promote the matching commit to the production domains.

If approval is rejected or migration fails, the new Vercel deployment must not
be promoted. The currently active production deployment remains in service.

## One-time GitHub configuration (repository owner)

1. Open **Repository Settings > Environments** and create an environment named
   exactly `production`.
2. Restrict deployment branches to the protected `main` branch.
3. Add Marvin and/or the authorized production owner as required reviewers.
4. Enable prevention of self-review when the team has at least two authorized
   reviewers.
5. Add an environment secret named exactly `PRODUCTION_DATABASE_URL`.
6. Use the production Supabase PostgreSQL connection intended for migrations.
   Do not use a transaction-pooler URL, and never paste the value into source
   files, workflow logs, pull requests, or chat.
7. Add an environment secret named exactly `FINANCIAL_RUNTIME_DATABASE_URL`.
   It must resolve to the separately verified least-privilege application role.
8. Add an environment secret named exactly `PRODUCTION_DATABASE_EXPECTED_NAME`.
   This is the exact value returned by PostgreSQL `current_database()` for the
   approved target; it is not a connection string.
9. Add repository/environment variables for
   `BINARY_RESERVE_ADMISSION_MODE`, `BINARY_RESERVE_MIN_AVAILABLE_PHP`, and
   `BINARY_RESERVE_MIN_COVERAGE_PERCENT`. Keep the mode at `monitor` until
   Finance approves measured thresholds from staging stress tests.
10. Protect `main` and require the normal test/build checks before merge.

Environment protection is the control that creates the second approval click.
Without it, the migration job starts automatically after merge.

## One-time Vercel configuration (project owner)

1. Open the HIROMA production project in Vercel.
2. Open the Production environment's **Deployment Checks** settings.
3. Add the GitHub check named exactly `Production financial attestation` as a
   required deployment check.
4. Keep automatic production aliasing enabled so Vercel promotes the build only
   after the required check succeeds.
5. Do not use **Force Promote** to bypass a pending or failed migration check.
6. Confirm that Preview environment variables do not contain production
   database credentials.

Do not rely on this workflow until a harmless rehearsal confirms that Vercel
really holds the production alias while the GitHub environment is awaiting
approval.

## Release checklist

Before approving production:

- Confirm the workflow is running for the exact merged commit SHA.
- Confirm the pull request identifies every new migration directory.
- Confirm database backups and recovery are available.
- For `deploy` mode, enter the internal tested backup/restore-point reference.
  The workflow retains only its digest and never prints the reference.
- Review destructive SQL (`DROP`, destructive `ALTER`, bulk updates, and data
  backfills) separately before approval.
- Prefer backward-compatible, additive migrations so the currently live code
  continues to work while migration and promotion are in progress.

After a green migration and Vercel promotion:

- Confirm the deployed commit SHA matches the merged commit.
- Smoke-test login, registration, inventory/orders, wallet/commissions/payouts,
  QR walk-in ordering, support tickets, and staff permissions.
- Review GitHub, Vercel, and application logs without exposing secret values.
- Download and retain the `financial-attestation-<commit>-<attempt>` artifact.

## Binary reserve admission rollout

The guard is deliberately additive and defaults to `monitor`.

- `monitor`: reserve warnings are recorded and shown in the admin Reserve Ledger,
  but PIN issuance continues. Package points, direct referral, binary pairing,
  daily caps, upgrades, and existing balances are unchanged.
- `enforce`: a paid PIN issuance or release is checked inside the same database
  transaction under the authoritative `binary-reserve-funding` lock. If the
  approved policy is breached, that PIN issuance/release rolls back. Existing
  members, existing PINs, cashier shifts, and balances are not modified.

Do not enable `enforce` without an explicitly approved minimum available reserve
or coverage threshold. The application rejects an enforcement configuration
that has neither. Thresholds must come from the 5,000-member stress simulation,
production-like staging load tests, treasury headroom, issued-but-unused PIN
exposure, and legal/accounting review—not an invented constant.

The Reserve Ledger displays:

- uncommitted reserve available for new pairs;
- reserve earmarked for earned binary commission;
- payable binary liability and coverage;
- historical unfunded records, which must remain zero;
- issued-but-unused PIN binary allocation exposure;
- total left/right carryover waiting for an opposite leg; and
- the largest payable cascade and recipient count observed in the last 30 days.

## Failure handling

- **No approval:** nothing is migrated; do not promote the new Vercel build.
- **Reserve warning in monitor mode:** investigate and replenish or pause new PIN
  issuance voluntarily; no cashier or member state is changed automatically.
- **Reserve policy blocked in enforce mode:** do not bypass the guard. Finance
  must reconcile and replenish protected funds or approve a time-bounded policy
  change through the normal configuration process.
- **Migration failure:** stop. Do not rerun blindly and do not use `db push`,
  `migrate dev`, or manual SQL as an improvised fix.
- **Migration succeeds but deployment fails:** keep the previous deployment
  active. Additive migrations should remain compatible with it while the
  deployment issue is repaired.
- **Application smoke test fails:** roll the Vercel alias back to the previous
  deployment. Database rollback requires a reviewed forward-fix or a tested
  restore plan; do not automatically reverse a production migration.

## Moving to a future production stack

The workflow is portable. For a separate public-launch GitHub/Supabase/Vercel
stack, recreate the protected `production` environment and Vercel deployment
check, then supply the new stack's secrets. No production project identifiers or
credentials are hard-coded in this repository.
