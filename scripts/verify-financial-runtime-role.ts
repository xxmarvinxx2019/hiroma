import "dotenv/config";
import { Client } from "pg";

const connectionString = process.env.FINANCIAL_RUNTIME_DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error(
    "FINANCIAL_RUNTIME_DATABASE_URL is required. Point it at the production runtime role, never the migration/owner role.",
  );
}

const protectedTables = [
  "users",
  "reseller_profiles",
  "packages",
  "products",
  "pins",
  "pin_requests",
  "registration_financials",
  "pin_registration_product_snapshots",
  "direct_referral_settlement_events",
  "upgrade_financials",
  "pin_upgrade_product_snapshots",
  "binary_reserve_lots",
  "binary_reserve_consumptions",
  "binary_pair_events",
  "binary_settlement_events",
  "binary_payable_lots",
  "binary_payout_consumptions",
  "product_binary_positions",
  "product_binary_order_events",
  "product_binary_pair_events",
  "product_binary_payable_lots",
  "product_binary_payout_consumptions",
  "product_binary_funding_lots",
  "product_binary_funding_consumptions",
  "product_binary_settlement_jobs",
  "orders",
  "order_items",
  "inventory_movements",
  "direct_referral_reserve_lots",
  "direct_referral_payout_consumptions",
  "commissions",
  "wallet_ledger_entries",
  "wallets",
  "payouts",
  "payable_lot_forfeitures",
  "reseller_deactivation_events",
  "binary_tree_nodes",
  "audit_logs",
  "member_id_sequences",
  "member_id_issuances",
  "package_upgrade_paths",
  "package_upgrade_products",
] as const;

const protectedFinancialFunctions = [
  "public.apply_wallet_ledger_entry()",
  "public.allocate_approved_direct_referral_payout()",
  "public.allocate_approved_binary_payout()",
  "public.allocate_approved_product_binary_payout()",
  "public.fund_product_binary_commission()",
  "public.qualify_product_binary_order_trigger()",
  "public.maintain_binary_tree_ancestor_counts()",
  "public.allocate_direct_referral_payout(text,text,numeric,timestamp without time zone)",
  "public.allocate_binary_payout(text,text,numeric,timestamp with time zone)",
  "public.allocate_product_binary_payout(text,text,numeric,timestamp with time zone)",
  "public.consume_product_binary_funding(text,numeric,timestamp with time zone)",
  "public.qualify_product_binary_order(text)",
] as const;

type RoleRisk = {
  rolname: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
};

type ProtectedObject = {
  table_name: string;
  owner_name: string;
  runtime_is_owner_member: boolean;
  can_truncate: boolean;
  can_trigger: boolean;
};

function quoteSummary(values: string[]) {
  return values.length === 0 ? "none" : values.join(", ");
}

async function main() {
  const client = new Client({ connectionString, application_name: "hiroma-financial-role-verifier" });
  await client.connect();

  try {
    const identity = await client.query<{
      runtime_role: string;
      database_name: string;
      schema_name: string;
      replication_mode: string;
      server_version_num: number;
    }>(`
      SELECT current_user AS runtime_role,
             current_database() AS database_name,
             current_schema() AS schema_name,
             current_setting('session_replication_role') AS replication_mode,
             current_setting('server_version_num')::INTEGER AS server_version_num
    `);
    const runtime = identity.rows[0];
    if (!runtime) throw new Error("Could not read the runtime database identity.");
    if (runtime.replication_mode !== "origin") {
      throw new Error(
        `Unsafe session_replication_role=${runtime.replication_mode}; the application must connect in origin mode.`,
      );
    }
    if (Number(runtime.server_version_num) < 150000) {
      throw new Error(
        `PostgreSQL ${runtime.server_version_num} is below Hiroma's verified minimum (15). Use the tested PostgreSQL 17 baseline where possible.`,
      );
    }

    const roleRisks = await client.query<RoleRisk>(`
      WITH RECURSIVE reachable_roles(role_id) AS (
        SELECT oid FROM pg_roles WHERE rolname = current_user
        UNION
        SELECT membership.roleid
        FROM pg_auth_members membership
        JOIN reachable_roles reachable ON reachable.role_id = membership.member
      )
      SELECT role.rolname,
             role.rolsuper,
             role.rolcreaterole,
             role.rolcreatedb,
             role.rolreplication,
             role.rolbypassrls
      FROM reachable_roles reachable
      JOIN pg_roles role ON role.oid = reachable.role_id
      WHERE role.rolsuper
         OR role.rolcreaterole
         OR role.rolcreatedb
         OR role.rolreplication
         OR role.rolbypassrls
      ORDER BY role.rolname
    `);
    if (roleRisks.rows.length > 0) {
      throw new Error(
        `Runtime role inherits dangerous database attributes through: ${quoteSummary(roleRisks.rows.map((row) => row.rolname))}.`,
      );
    }

  const structuralPrivileges = await client.query<{
    owns_database: boolean;
    owns_schema_or_inherits_owner: boolean;
    can_create_in_database: boolean;
    can_temp_in_database: boolean;
    can_create_in_schema: boolean;
  }>(`
      WITH RECURSIVE reachable_roles(role_id) AS (
        SELECT oid FROM pg_roles WHERE rolname = current_user
        UNION
        SELECT membership.roleid
        FROM pg_auth_members membership
        JOIN reachable_roles reachable ON reachable.role_id = membership.member
      )
      SELECT EXISTS (
               SELECT 1
               FROM pg_database database
               JOIN reachable_roles reachable ON reachable.role_id = database.datdba
               WHERE database.datname = current_database()
             ) AS owns_database,
             EXISTS (
               SELECT 1
               FROM pg_namespace namespace
               JOIN reachable_roles reachable ON reachable.role_id = namespace.nspowner
               WHERE namespace.nspname = 'public'
             ) AS owns_schema_or_inherits_owner,
             has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_in_database,
             has_database_privilege(current_user, current_database(), 'TEMP') AS can_temp_in_database,
             has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_schema
    `);
    const structural = structuralPrivileges.rows[0];
    if (
      structural?.owns_database ||
      structural?.owns_schema_or_inherits_owner ||
      structural?.can_create_in_database ||
      structural?.can_temp_in_database ||
      structural?.can_create_in_schema
    ) {
      throw new Error(
        "Runtime role can create database/schema/temp objects or inherits structural ownership.",
      );
    }

    const writableSchemas = await client.query<{ schema_name: string }>(`
      SELECT namespace.nspname AS schema_name
      FROM pg_namespace namespace
      WHERE namespace.nspname <> 'information_schema'
        AND namespace.nspname NOT LIKE 'pg_%'
        AND has_schema_privilege(current_user, namespace.oid, 'CREATE')
      ORDER BY namespace.nspname
    `);
    if (writableSchemas.rows.length > 0) {
      throw new Error(
        `Runtime role can create shadow objects in schemas: ${quoteSummary(writableSchemas.rows.map((row) => row.schema_name))}.`,
      );
    }

    const objects = await client.query<ProtectedObject>(`
      WITH RECURSIVE reachable_roles(role_id) AS (
        SELECT oid FROM pg_roles WHERE rolname = current_user
        UNION
        SELECT membership.roleid
        FROM pg_auth_members membership
        JOIN reachable_roles reachable ON reachable.role_id = membership.member
      )
      SELECT class.relname AS table_name,
             owner.rolname AS owner_name,
             EXISTS (
               SELECT 1 FROM reachable_roles reachable WHERE reachable.role_id = class.relowner
             ) AS runtime_is_owner_member,
             has_table_privilege(current_user, class.oid, 'TRUNCATE') AS can_truncate,
             has_table_privilege(current_user, class.oid, 'TRIGGER') AS can_trigger
      FROM pg_class class
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      JOIN pg_roles owner ON owner.oid = class.relowner
      WHERE namespace.nspname = 'public'
        AND class.relkind IN ('r', 'p')
      ORDER BY class.relname
    `);

    const foundTables = new Set(objects.rows.map((row) => row.table_name));
    const missingTables = protectedTables.filter((table) => !foundTables.has(table));
    if (missingTables.length > 0) {
      throw new Error(
        `Financial schema is incomplete; missing protected tables: ${quoteSummary([...missingTables])}. Apply migrations with the owner role first.`,
      );
    }

    const unsafeObjects = objects.rows.filter(
      (row) => row.runtime_is_owner_member || row.can_truncate || row.can_trigger,
    );
    if (unsafeObjects.length > 0) {
      throw new Error(
        `Runtime role can own, truncate, or replace triggers on public application tables: ${quoteSummary(unsafeObjects.map((row) => row.table_name))}.`,
      );
    }

    const mutableTriggerFunctions = await client.query<{
      function_name: string;
      owner_name: string;
      runtime_can_execute: boolean;
    }>(`
      WITH RECURSIVE reachable_roles(role_id) AS (
        SELECT oid FROM pg_roles WHERE rolname = current_user
        UNION
        SELECT membership.roleid
        FROM pg_auth_members membership
        JOIN reachable_roles reachable ON reachable.role_id = membership.member
      )
      SELECT DISTINCT procedure.proname AS function_name,
             owner.rolname AS owner_name,
             has_function_privilege(current_user, procedure.oid, 'EXECUTE') AS runtime_can_execute
      FROM pg_trigger trigger
      JOIN pg_class class ON class.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
      JOIN pg_namespace function_namespace ON function_namespace.oid = procedure.pronamespace
      JOIN pg_roles owner ON owner.oid = procedure.proowner
      WHERE NOT trigger.tgisinternal
        AND namespace.nspname = 'public'
        AND function_namespace.nspname = 'public'
        AND (
          EXISTS (SELECT 1 FROM reachable_roles reachable WHERE reachable.role_id = procedure.proowner)
          OR has_function_privilege(current_user, procedure.oid, 'EXECUTE')
        )
      ORDER BY procedure.proname
    `);
    if (mutableTriggerFunctions.rows.length > 0) {
      throw new Error(
        `Runtime role can own or execute public application trigger functions: ${quoteSummary(mutableTriggerFunctions.rows.map((row) => row.function_name))}.`,
      );
    }

    const protectedFunctions = await client.query<{
      function_signature: string;
      function_name: string | null;
      owner_name: string | null;
      runtime_is_owner_member: boolean;
      runtime_can_execute: boolean;
      is_security_definer: boolean;
      has_fixed_search_path: boolean;
    }>(`
      WITH RECURSIVE reachable_roles(role_id) AS (
        SELECT oid FROM pg_roles WHERE rolname = current_user
        UNION
        SELECT membership.roleid
        FROM pg_auth_members membership
        JOIN reachable_roles reachable ON reachable.role_id = membership.member
      ), required(function_signature) AS (
        SELECT unnest($1::text[])
      )
      SELECT required.function_signature,
             procedure.oid::regprocedure::text AS function_name,
             owner.rolname AS owner_name,
             COALESCE(EXISTS (
               SELECT 1
               FROM reachable_roles reachable
               WHERE reachable.role_id = procedure.proowner
             ), false) AS runtime_is_owner_member,
             COALESCE(
               has_function_privilege(current_user, procedure.oid, 'EXECUTE'),
               false
             ) AS runtime_can_execute,
             COALESCE(procedure.prosecdef, false) AS is_security_definer,
             COALESCE(
               procedure.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[],
               false
             ) AS has_fixed_search_path
      FROM required
      LEFT JOIN pg_proc procedure
        ON procedure.oid = to_regprocedure(required.function_signature)
      LEFT JOIN pg_roles owner ON owner.oid = procedure.proowner
      ORDER BY required.function_signature
    `, [protectedFinancialFunctions]);

    const unsafeFunctions = protectedFunctions.rows.filter(
      (row) =>
        row.function_name === null ||
        row.runtime_is_owner_member ||
        row.runtime_can_execute ||
        !row.is_security_definer ||
        !row.has_fixed_search_path,
    );
    if (unsafeFunctions.length > 0) {
      throw new Error(
        `Required financial owner functions are missing or bypassable: ${quoteSummary(unsafeFunctions.map((row) => row.function_signature))}.`,
      );
    }

    const walletMutation = await client.query<{
      can_update: boolean;
      can_delete: boolean;
    }>(`
      SELECT has_table_privilege(current_user, 'public.wallets', 'UPDATE') AS can_update,
             has_table_privilege(current_user, 'public.wallets', 'DELETE') AS can_delete
    `);
    if (walletMutation.rows[0]?.can_update || walletMutation.rows[0]?.can_delete) {
      throw new Error(
        "Runtime role can directly update/delete wallet balances; only the owner-executed ledger trigger may do so.",
      );
    }

    const disabledTriggers = await client.query<{
      table_name: string;
      trigger_name: string;
      trigger_mode: string;
    }>(`
      SELECT class.relname AS table_name,
             trigger.tgname AS trigger_name,
             trigger.tgenabled AS trigger_mode
      FROM pg_trigger trigger
      JOIN pg_class class ON class.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      WHERE NOT trigger.tgisinternal
        AND namespace.nspname = 'public'
        AND trigger.tgenabled = 'D'
      ORDER BY class.relname, trigger.tgname
    `);
    if (disabledTriggers.rows.length > 0) {
      throw new Error(
        `Protected financial triggers are disabled: ${quoteSummary(disabledTriggers.rows.map((row) => `${row.table_name}.${row.trigger_name}`))}.`,
      );
    }

    const parameterPrivilege = await client.query<{ can_set_replication_role: boolean }>(`
      SELECT has_parameter_privilege(
               current_user,
               'session_replication_role',
               'SET'
             ) AS can_set_replication_role
    `);
    if (parameterPrivilege.rows[0]?.can_set_replication_role) {
      throw new Error("Runtime role can SET session_replication_role and bypass ordinary triggers.");
    }

    let replicaModeWasAccepted = false;
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL session_replication_role = 'replica'");
      replicaModeWasAccepted = true;
    } catch (error) {
      const sqlState = (error as { code?: string }).code;
      if (sqlState !== "42501") throw error;
    } finally {
      await client.query("ROLLBACK");
    }
    if (replicaModeWasAccepted) {
      throw new Error("Runtime role successfully entered replica mode; ordinary financial triggers are bypassable.");
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          runtimeRole: runtime.runtime_role,
          database: runtime.database_name,
          schema: runtime.schema_name,
          protectedTablesChecked: objects.rows.length,
          disabledProtectedTriggers: 0,
          sessionReplicationRole: "origin",
          serverVersionNum: runtime.server_version_num,
          canBypassFinancialTriggers: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
