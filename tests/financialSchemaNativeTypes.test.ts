import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const directSettlementMigration = readFileSync(
  "prisma/migrations/20260902149000_seal_direct_referral_settlements/migration.sql",
  "utf8",
);

test("Prisma preserves UUID native types for financial ledger identities", () => {
  assert.match(
    schema,
    /model RegistrationFinancial \{[\s\S]*?id\s+String\s+@id @default\(uuid\(\)\) @db\.Uuid/,
  );
  assert.match(
    schema,
    /model UpgradeFinancial \{[\s\S]*?id\s+String\s+@id @default\(uuid\(\)\) @db\.Uuid/,
  );
  assert.match(
    schema,
    /model BinaryReserveLot \{[\s\S]*?registration_financial_id\s+String\?\s+@unique @db\.Uuid[\s\S]*?upgrade_financial_id\s+String\?\s+@unique @db\.Uuid/,
  );
  assert.match(
    schema,
    /model BinaryReserveConsumption \{[\s\S]*?reserve_lot_id\s+String\?\s+@db\.Uuid/,
  );
});

test("direct settlement cutover fails closed on db-push TEXT identity drift", () => {
  assert.match(directSettlementMigration, /server_version_num'\)::INTEGER < 150000/);
  for (const [table, column] of [
    ["registration_financials", "id"],
    ["upgrade_financials", "id"],
    ["binary_reserve_lots", "registration_financial_id"],
    ["binary_reserve_lots", "upgrade_financial_id"],
    ["binary_reserve_consumptions", "reserve_lot_id"],
  ]) {
    assert.ok(
      directSettlementMigration.includes(`('${table}', '${column}')`),
      `missing native UUID preflight for ${table}.${column}`,
    );
  }
  assert.match(directSettlementMigration, /native_type <> 'uuid'::regtype/);
  assert.match(directSettlementMigration, /Stop deployment/);
  assert.doesNotMatch(directSettlementMigration, /ALTER COLUMN[\s\S]*TYPE UUID/i);
});
