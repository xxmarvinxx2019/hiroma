import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20260902153000_harden_financial_trigger_execution/migration.sql",
  "utf8",
);

test("financial trigger execution hardening is one locked PostgreSQL transaction", () => {
  assert.equal((migration.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.match(migration, /server_version_num'\)::INTEGER < 150000/);
  assert.match(migration, /LOCK TABLE[\s\S]*"wallet_ledger_entries"[\s\S]*"wallets"[\s\S]*IN SHARE ROW EXCLUSIVE MODE;/);
});

test("wallet and nested financial wrappers use owner authority with a fixed search path", () => {
  for (const requiredFunction of [
    "public.apply_wallet_ledger_entry()",
    "public.allocate_approved_direct_referral_payout()",
    "public.allocate_approved_binary_payout()",
    "public.allocate_approved_product_binary_payout()",
    "public.fund_product_binary_commission()",
    "public.qualify_product_binary_order_trigger()",
    "public.maintain_binary_tree_ancestor_counts()",
  ]) {
    assert.ok(migration.includes(`'${requiredFunction}'`));
  }
  assert.match(migration, /ALTER FUNCTION %s SECURITY DEFINER/);
  assert.match(migration, /SET search_path TO pg_catalog, public, pg_temp/);
});

test("PUBLIC cannot reuse a protected trigger function to spoof trigger depth", () => {
  assert.match(migration, /WHERE NOT trigger\.tgisinternal/);
  assert.match(migration, /table_namespace\.nspname = 'public'/);
  assert.match(migration, /function_namespace\.nspname = 'public'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/);
  assert.doesNotMatch(migration, /class\.relname = ANY/);
});
