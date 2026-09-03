import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const verifier = readFileSync("scripts/verify-financial-runtime-role.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

test("runtime verifier requires an explicit dedicated connection URL", () => {
  assert.match(verifier, /FINANCIAL_RUNTIME_DATABASE_URL/);
  assert.doesNotMatch(verifier, /process\.env\.DATABASE_URL\s*\|\|/);
});

test("runtime verifier rejects role and ownership paths that can bypass financial boundaries", () => {
  for (const requiredCheck of [
    "rolsuper",
    "rolcreaterole",
    "rolcreatedb",
    "rolreplication",
    "rolbypassrls",
    "owns_database",
    "owns_schema_or_inherits_owner",
    "can_create_in_database",
    "can_temp_in_database",
    "can_create_in_schema",
    "runtime_is_owner_member",
    "can_truncate",
    "can_trigger",
  ]) {
    assert.ok(verifier.includes(requiredCheck), `missing runtime role check: ${requiredCheck}`);
  }
});

test("runtime verifier proves trigger state and replica-mode denial", () => {
  assert.match(verifier, /trigger\.tgenabled = 'D'/);
  assert.match(verifier, /has_parameter_privilege/);
  assert.match(verifier, /SET LOCAL session_replication_role = 'replica'/);
  assert.match(verifier, /sqlState !== "42501"/);
  assert.match(verifier, /server_version_num/);
  assert.match(verifier, /< 150000/);
  assert.match(verifier, /has_function_privilege/);
  assert.match(verifier, /public\.wallets', 'UPDATE'/);
  assert.match(verifier, /public\.wallets', 'DELETE'/);
});

test("runtime verifier closes temp-trigger and schema-shadowing bypasses", () => {
  assert.match(verifier, /has_database_privilege\(current_user, current_database\(\), 'TEMP'\)/);
  assert.match(verifier, /has_database_privilege\(current_user, current_database\(\), 'CREATE'\)/);
  assert.match(verifier, /has_schema_privilege\(current_user, namespace\.oid, 'CREATE'\)/);
  assert.match(verifier, /can own or execute public application trigger functions/);
  assert.match(verifier, /function_namespace\.nspname = 'public'/);
});

test("runtime verifier checks structural privileges and disabled triggers across every public table", () => {
  assert.match(verifier, /namespace\.nspname = 'public'[\s\S]*class\.relkind IN \('r', 'p'\)[\s\S]*ORDER BY class\.relname/);
  assert.match(verifier, /can own, truncate, or replace triggers on public application tables/);
  assert.match(verifier, /WHERE NOT trigger\.tgisinternal[\s\S]*namespace\.nspname = 'public'[\s\S]*trigger\.tgenabled = 'D'/);
});

test("runtime verifier covers each protected financial subsystem", () => {
  for (const table of [
    "registration_financials",
    "pin_registration_product_snapshots",
    "direct_referral_settlement_events",
    "upgrade_financials",
    "pin_upgrade_product_snapshots",
    "binary_pair_events",
    "product_binary_order_events",
    "product_binary_funding_lots",
    "product_binary_settlement_jobs",
    "orders",
    "order_items",
    "inventory_movements",
    "products",
    "pins",
    "pin_requests",
    "packages",
    "reseller_profiles",
    "users",
    "commissions",
    "wallet_ledger_entries",
    "payouts",
    "payable_lot_forfeitures",
    "reseller_deactivation_events",
    "binary_tree_nodes",
    "member_id_sequences",
    "member_id_issuances",
    "package_upgrade_paths",
  ]) {
    assert.ok(verifier.includes(`"${table}"`), `missing protected table: ${table}`);
  }
});

test("package exposes the production runtime-role verification command", () => {
  assert.equal(
    packageJson.scripts["verify:financial-runtime-role"],
    "tsx scripts/verify-financial-runtime-role.ts",
  );
});

test("runtime verifier proves owner-only security-definer helper boundaries", () => {
  for (const requiredFunction of [
    "public.apply_wallet_ledger_entry()",
    "public.allocate_approved_direct_referral_payout()",
    "public.maintain_binary_tree_ancestor_counts()",
    "public.allocate_binary_payout(text,text,numeric,timestamp with time zone)",
    "public.consume_product_binary_funding(text,numeric,timestamp with time zone)",
    "public.qualify_product_binary_order(text)",
  ]) {
    assert.ok(verifier.includes(`\"${requiredFunction}\"`));
  }
  assert.match(verifier, /procedure\.prosecdef/);
  assert.match(verifier, /search_path=pg_catalog, public, pg_temp/);
  assert.match(verifier, /runtime_can_execute/);
  assert.match(verifier, /Required financial owner functions are missing or bypassable/);
});
