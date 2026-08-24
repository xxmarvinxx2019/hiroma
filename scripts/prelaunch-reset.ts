import "dotenv/config";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const EXECUTE_FLAG = "--execute";
const REQUIRED_CONFIRMATION = "RESET_HIROMA_PRELAUNCH_DATA";
const PROTECTED_USERNAMES = ["hiroadmin", "hiroma"] as const;
const ROOT_USERNAME = "hiroma";
const INVENTORY_OWNER_USERNAME = "hiroadmin";

// Business configuration that must survive the reset is intentionally absent:
// products, packages, package_products, ranks, rank_periods, system_settings,
// and _prisma_migrations.
const TRUNCATED_TABLES = [
  "audit_logs",
  "binary_pair_events",
  "binary_payable_lots",
  "binary_payout_consumptions",
  "binary_reserve_consumptions",
  "binary_reserve_lots",
  "binary_tree_nodes",
  "commissions",
  "direct_referral_payout_consumptions",
  "direct_referral_reserve_lots",
  "distributor_profiles",
  "hiro_messages",
  "hiro_conversations",
  "identity_account_limits",
  "inventory",
  "inventory_movements",
  "login_rate_limits",
  "name_cap_registry",
  "notifications",
  "order_items",
  "orders",
  "pairing_logs",
  "passkey_challenges",
  "password_reset_tokens",
  "payment_methods",
  "payouts",
  "pin_requests",
  "pins",
  "product_area_visibility",
  "product_binary_funding_consumptions",
  "product_binary_funding_lots",
  "product_binary_order_events",
  "product_binary_pair_events",
  "product_binary_payable_lots",
  "product_binary_payout_consumptions",
  "product_binary_positions",
  "public_verification_rate_limits",
  "registration_financials",
  "reseller_deactivation_events",
  "reseller_profiles",
  "staff_profiles",
  "support_attachments",
  "support_captcha_challenges",
  "support_messages",
  "support_requests",
  "upgrade_financials",
  "walk_in_member_scan_proofs",
  "wallets",
] as const;

const CONFIGURATION_TABLES = [
  "products",
  "packages",
  "package_products",
  "ranks",
  "rank_periods",
  "system_settings",
] as const;

type CountRow = { table_name: string; row_count: number };
type UserRow = {
  id: string;
  username: string;
  role: string;
  member_id: string;
};

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseFingerprint(connectionString: string) {
  const url = new URL(connectionString);
  const identity = `${url.hostname}:${url.port || "5432"}/${url.pathname.replace(/^\//, "")}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

async function tableCounts(client: PoolClient, tables: readonly string[]) {
  const counts: CountRow[] = [];
  for (const table of tables) {
    const result = await client.query<{ row_count: number }>(
      `SELECT COUNT(*)::int AS row_count FROM ${quoteIdentifier(table)}`,
    );
    counts.push({ table_name: table, row_count: Number(result.rows[0]?.row_count || 0) });
  }
  return counts;
}

async function loadProtectedUsers(client: PoolClient) {
  const result = await client.query<UserRow>(
    `SELECT id::text, username, role::text, member_id
       FROM users
      WHERE username = ANY($1::text[])
      ORDER BY username`,
    [PROTECTED_USERNAMES],
  );
  const found = new Set(result.rows.map((row) => row.username));
  const missing = PROTECTED_USERNAMES.filter((username) => !found.has(username));
  if (missing.length > 0) {
    throw new Error(`Protected account(s) missing: ${missing.join(", ")}.`);
  }
  if (result.rows.some((row) => row.role !== "admin")) {
    throw new Error("Every protected account must still have the admin role.");
  }
  return result.rows;
}

async function buildReport(client: PoolClient, fingerprint: string) {
  const protectedUsers = await loadProtectedUsers(client);
  // A PoolClient accepts one active query at a time. Keep the audit sequential
  // so the dry run remains compatible with pg 9 and later.
  const configuration = await tableCounts(client, CONFIGURATION_TABLES);
  const operational = await tableCounts(client, TRUNCATED_TABLES);
  const users = await client.query<{ role: string; count: number }>(
    `SELECT role::text, COUNT(*)::int AS count FROM users GROUP BY role ORDER BY role`,
  );
  const inventory = await client.query<{ rows: number; quantity: number; reserved: number }>(
    `SELECT COUNT(*)::int AS rows,
            COALESCE(SUM(quantity), 0)::int AS quantity,
            COALESCE(SUM(reserved_quantity), 0)::int AS reserved
       FROM inventory`,
  );
  const root = await client.query<{ roots: number; left_count: number; right_count: number }>(
    `SELECT COUNT(*)::int AS roots,
            COALESCE(SUM(left_count), 0)::int AS left_count,
            COALESCE(SUM(right_count), 0)::int AS right_count
       FROM binary_tree_nodes
      WHERE parent_id IS NULL`,
  );

  const preservedUserIds = new Set(protectedUsers.map((user) => user.id));
  const allUsers = users.rows.reduce((sum, row) => sum + Number(row.count), 0);

  return {
    mode: process.argv.includes(EXECUTE_FLAG) ? "execute" : "dry-run",
    database_fingerprint: fingerprint,
    protected_accounts: protectedUsers,
    preserved_configuration: configuration,
    current_operational_rows: operational,
    current_users_by_role: users.rows,
    users_to_delete: allUsers - preservedUserIds.size,
    current_inventory: inventory.rows[0],
    current_network_root_summary: root.rows[0],
    expected_after_reset: {
      users: PROTECTED_USERNAMES.length,
      distributors: 0,
      resellers: 0,
      staff: 0,
      inventory_rows: configuration.find((row) => row.table_name === "products")?.row_count || 0,
      inventory_quantity: 0,
      inventory_reserved: 0,
      binary_roots: 1,
      binary_left_count: 0,
      binary_right_count: 0,
      operational_history_rows: 0,
    },
  };
}

function assertExecutionGuards(fingerprint: string) {
  if (process.env.ALLOW_PRELAUNCH_RESET !== "true") {
    throw new Error("Set ALLOW_PRELAUNCH_RESET=true to authorize an execution attempt.");
  }
  if (process.env.PRELAUNCH_RESET_BACKUP_CONFIRMED !== "true") {
    throw new Error("A verified backup is required: set PRELAUNCH_RESET_BACKUP_CONFIRMED=true.");
  }
  if (process.env.PRELAUNCH_RESET_CONFIRM !== REQUIRED_CONFIRMATION) {
    throw new Error(`Set PRELAUNCH_RESET_CONFIRM=${REQUIRED_CONFIRMATION}.`);
  }
  if (process.env.PRELAUNCH_RESET_DATABASE_FINGERPRINT !== fingerprint) {
    throw new Error(
      `Database fingerprint mismatch. Expected PRELAUNCH_RESET_DATABASE_FINGERPRINT=${fingerprint}.`,
    );
  }
}

async function executeReset(client: PoolClient, protectedUsers: UserRow[]) {
  const protectedIds = protectedUsers.map((user) => user.id);
  const tableList = TRUNCATED_TABLES.map(quoteIdentifier).join(", ");

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hiroma-prelaunch-reset-v1'))");
    await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY`);

    // Admin passkeys are preserved; every non-admin passkey is removed before
    // deleting the associated test account.
    await client.query("DELETE FROM passkey_credentials WHERE NOT (user_id = ANY($1::text[]))", [
      protectedIds,
    ]);
    await client.query("DELETE FROM users WHERE NOT (id = ANY($1::text[]))", [protectedIds]);

    const root = protectedUsers.find((user) => user.username === ROOT_USERNAME);
    const inventoryOwner = protectedUsers.find(
      (user) => user.username === INVENTORY_OWNER_USERNAME,
    );
    if (!root || !inventoryOwner) throw new Error("Protected root or inventory owner is unavailable.");

    await client.query(
      `INSERT INTO binary_tree_nodes
         (id, user_id, parent_id, position, sponsor_id, left_count, right_count, is_overflow, created_at)
       VALUES (gen_random_uuid()::text, $1, NULL, NULL, NULL, 0, 0, false, NOW())`,
      [root.id],
    );
    await client.query(
      `INSERT INTO inventory
         (id, owner_id, product_id, quantity, reserved_quantity, low_stock_threshold, updated_at)
       SELECT gen_random_uuid()::text, $1, p.id, 0, 0, 10, NOW()
         FROM products p`,
      [inventoryOwner.id],
    );

    // Ticket numbers are operational data. Reset the sequence only when it is present.
    await client.query(
      `DO $$ BEGIN
         IF to_regclass('public.support_ticket_number_seq') IS NOT NULL THEN
           PERFORM setval('support_ticket_number_seq', 1, false);
         END IF;
       END $$`,
    );

    const assertions = await client.query<{
      users: number;
      non_admin_users: number;
      products: number;
      packages: number;
      package_products: number;
      ranks: number;
      inventory_rows: number;
      inventory_quantity: number;
      inventory_reserved: number;
      roots: number;
      left_count: number;
      right_count: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM users)::int users,
         (SELECT COUNT(*) FROM users WHERE role <> 'admin')::int non_admin_users,
         (SELECT COUNT(*) FROM products)::int products,
         (SELECT COUNT(*) FROM packages)::int packages,
         (SELECT COUNT(*) FROM package_products)::int package_products,
         (SELECT COUNT(*) FROM ranks)::int ranks,
         (SELECT COUNT(*) FROM inventory)::int inventory_rows,
         (SELECT COALESCE(SUM(quantity), 0) FROM inventory)::int inventory_quantity,
         (SELECT COALESCE(SUM(reserved_quantity), 0) FROM inventory)::int inventory_reserved,
         (SELECT COUNT(*) FROM binary_tree_nodes WHERE parent_id IS NULL)::int roots,
         (SELECT COALESCE(SUM(left_count), 0) FROM binary_tree_nodes)::int left_count,
         (SELECT COALESCE(SUM(right_count), 0) FROM binary_tree_nodes)::int right_count`,
    );
    const result = assertions.rows[0];
    if (
      !result ||
      result.users !== PROTECTED_USERNAMES.length ||
      result.non_admin_users !== 0 ||
      result.inventory_rows !== result.products ||
      result.inventory_quantity !== 0 ||
      result.inventory_reserved !== 0 ||
      result.roots !== 1 ||
      result.left_count !== 0 ||
      result.right_count !== 0
    ) {
      throw new Error(`Post-reset assertions failed: ${JSON.stringify(result)}`);
    }

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL environment variable is not set.");

  const fingerprint = databaseFingerprint(connectionString);
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    const before = await buildReport(client, fingerprint);
    if (!process.argv.includes(EXECUTE_FLAG)) {
      console.log(JSON.stringify(before, null, 2));
      console.log("\nDry run only. No database records were changed.");
      return;
    }

    assertExecutionGuards(fingerprint);
    const protectedUsers = await loadProtectedUsers(client);
    const result = await executeReset(client, protectedUsers);
    const after = await buildReport(client, fingerprint);
    console.log(JSON.stringify({ before, post_reset_assertions: result, after }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
