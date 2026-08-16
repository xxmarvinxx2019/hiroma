# HIROMA production release automation

This repository uses an approval-gated production database migration workflow.
It is intentionally incomplete until the repository owner finishes the one-time
GitHub and Vercel dashboard configuration below.

## Intended release sequence

1. A pull request is reviewed and merged into `main`.
   The `Database migration review` check tells reviewers whether migration files
   were added and rejects modification or deletion of existing migration history.
2. Vercel builds the merged commit, but does not promote it to the production
   domains while its required deployment check is pending.
3. GitHub pauses the `Production database migration` job at the protected
   `production` environment.
4. An authorized reviewer selects **Review deployments**, chooses
   `production`, and selects **Approve and deploy**.
5. GitHub runs `prisma migrate deploy` against the production database and then
   runs `prisma migrate status`.
6. Only a successful `Production database migration` check permits Vercel to
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
7. Protect `main` and require the normal test/build checks before merge.

Environment protection is the control that creates the second approval click.
Without it, the migration job starts automatically after merge.

## One-time Vercel configuration (project owner)

1. Open the HIROMA production project in Vercel.
2. Open the Production environment's **Deployment Checks** settings.
3. Add the GitHub check named exactly `Production database migration` as a
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
- Review destructive SQL (`DROP`, destructive `ALTER`, bulk updates, and data
  backfills) separately before approval.
- Prefer backward-compatible, additive migrations so the currently live code
  continues to work while migration and promotion are in progress.

After a green migration and Vercel promotion:

- Confirm the deployed commit SHA matches the merged commit.
- Smoke-test login, registration, inventory/orders, wallet/commissions/payouts,
  QR walk-in ordering, support tickets, and staff permissions.
- Review GitHub, Vercel, and application logs without exposing secret values.

## Failure handling

- **No approval:** nothing is migrated; do not promote the new Vercel build.
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
