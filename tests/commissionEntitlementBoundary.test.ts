import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260902143000_enforce_exact_commission_entitlement/migration.sql',
    import.meta.url,
  ),
  'utf8',
)
const binaryCommission = readFileSync(
  new URL('../src/app/lib/binaryCommission.ts', import.meta.url),
  'utf8',
)
const productBinary = readFileSync(
  new URL('../src/app/lib/productBinary.ts', import.meta.url),
  'utf8',
)
const prismaSchema = readFileSync(
  new URL('../prisma/schema.prisma', import.meta.url),
  'utf8',
)

test('entitlement migration cuts over atomically under fixed-order writer locks', () => {
  assert.match(migration, /^--[^]*?\nBEGIN;/)
  assert.match(
    migration,
    /LOCK TABLE\s+"binary_pair_events",\s+"binary_settlement_events",\s+"commissions",\s+"product_binary_order_events",\s+"product_binary_pair_events",\s+"product_binary_positions",\s+"product_binary_settlement_jobs",\s+"registration_financials",\s+"upgrade_financials"\s+IN SHARE ROW EXCLUSIVE MODE;/,
  )
  assert.match(migration, /COMMIT;\s*$/)
})

test('duplicate commission-to-pair links stop migration before unique indexes', () => {
  const directFlashPreflight = migration.indexOf(
    'Duplicate retained Direct Referral commission sources require reconciliation',
  )
  const directFlashIndex = migration.indexOf(
    'CREATE UNIQUE INDEX IF NOT EXISTS "commissions_one_retained_direct_per_registration"',
  )
  const packagePreflight = migration.indexOf(
    'Duplicate Package Binary commission-to-pair links require reconciliation',
  )
  const packageIndex = migration.indexOf(
    'CREATE UNIQUE INDEX IF NOT EXISTS "binary_pair_events_normal_commission_id_key"',
  )
  const productPreflight = migration.indexOf(
    'Duplicate Product Binary commission-to-pair links require reconciliation',
  )
  const productIndex = migration.indexOf(
    'CREATE UNIQUE INDEX IF NOT EXISTS "product_binary_pair_events_normal_commission_id_key"',
  )
  const packageFlashPreflight = migration.indexOf(
    'Duplicate Package Binary retained-commission-to-pair links require reconciliation',
  )
  const packageFlashIndex = migration.indexOf(
    'CREATE UNIQUE INDEX IF NOT EXISTS "binary_pair_events_flashout_commission_id_key"',
  )
  const productFlashPreflight = migration.indexOf(
    'Duplicate Product Binary retained-commission-to-pair links require reconciliation',
  )
  const productFlashIndex = migration.indexOf(
    'CREATE UNIQUE INDEX IF NOT EXISTS "product_binary_pair_events_flashout_commission_id_key"',
  )

  assert.ok(directFlashPreflight >= 0 && directFlashPreflight < directFlashIndex)
  assert.ok(packagePreflight >= 0 && packagePreflight < packageIndex)
  assert.ok(productPreflight >= 0 && productPreflight < productIndex)
  assert.ok(packageFlashPreflight >= 0 && packageFlashPreflight < packageFlashIndex)
  assert.ok(productFlashPreflight >= 0 && productFlashPreflight < productFlashIndex)
  assert.match(migration, /GROUP BY "normal_commission_id"[\s\S]*HAVING COUNT\(\*\) > 1/)
  assert.match(migration, /GROUP BY "flashout_commission_id"[\s\S]*HAVING COUNT\(\*\) > 1/)
  assert.match(migration, /WHERE "normal_commission_id" IS NOT NULL/)
  assert.match(migration, /WHERE "flashout_commission_id" IS NOT NULL/)
})

test('historical modern-rule pair entitlements fail descriptively instead of being guessed', () => {
  assert.match(
    migration,
    /Historical Package Binary commission entitlement requires reconciliation/,
  )
  assert.match(
    migration,
    /Historical Product Binary commission entitlement requires reconciliation/,
  )
  assert.match(migration, /normal\."rule_version" IS DISTINCT FROM 'package-binary-v1'/)
  assert.match(migration, /normal\."rule_version" IS DISTINCT FROM 'product-binary-v1'/)
  assert.equal(
    (migration.match(/normal\."rule_version" IS DISTINCT FROM 'legacy-v1'/g) || []).length,
    2,
  )
  assert.equal(
    (migration.match(/flashout\."rule_version" IS DISTINCT FROM 'legacy-v1'/g) || []).length,
    2,
  )
  assert.match(migration, /commission\."rule_version" = 'package-binary-v1'[\s\S]*NOT EXISTS/)
  assert.match(migration, /commission\."rule_version" = 'product-binary-v1'[\s\S]*NOT EXISTS/)
})

test('direct referral credit is deferred until exact new member and sponsor are proven', () => {
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "commissions_validate_exact_entitlement"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(
    migration,
    /registration_financials" rf[\s\S]*binary_tree_nodes" source_node[\s\S]*source_node\."sponsor_id"/,
  )
  assert.match(migration, /NEW\."source_user_id" IS DISTINCT FROM direct_source_user_id/)
  assert.match(migration, /NEW\."user_id" IS DISTINCT FROM direct_sponsor_user_id/)
  assert.match(migration, /NEW\."amount" IS DISTINCT FROM direct_entitled_amount/)
})

test('package binary settlement source is the paid member event at its real parent and leg', () => {
  assert.match(
    migration,
    /source_kind" = 'registration'[\s\S]*binary_points_per_pair[\s\S]*registration_financials/,
  )
  assert.match(
    migration,
    /source_kind" = 'upgrade'[\s\S]*binary_points_difference[\s\S]*upgrade_financials/,
  )
  assert.match(migration, /node\."parent_id"[\s\S]*node\."position"::text/)
  assert.match(migration, /NEW\."parent_node_id" IS DISTINCT FROM actual_parent_node_id/)
  assert.match(migration, /NEW\."source_leg" IS DISTINCT FROM actual_source_leg/)
})

test('package binary commission must map one-to-one to its exact ancestor pair event', () => {
  assert.match(
    migration,
    /binary_pair_events" event[\s\S]*event\."normal_commission_id" = NEW\."id"/,
  )
  assert.match(migration, /event\."recipient_user_id" = NEW\."user_id"/)
  assert.match(migration, /event\."source_user_id" = NEW\."source_user_id"/)
  assert.match(migration, /event\."payable_amount" = NEW\."amount"/)
  assert.match(migration, /NEW\."points"::NUMERIC = event\."payable_pairs" \* event\."points_per_pair"/)
  assert.match(migration, /recipient is not an ancestor on the sealed source leg/)
  assert.match(
    migration,
    /ROUND\(COALESCE\(package\."pairing_bonus_value", 0\)\)::INTEGER/,
  )
  assert.match(migration, /NEW\."peso_per_point" IS DISTINCT FROM 0\.5/)
  assert.match(migration, /NEW\."points_per_pair" <= 0/)
  assert.match(
    migration,
    /FOR UPDATE OF profile\s+FOR SHARE OF package, recipient/,
  )
  assert.match(
    migration,
    /NEW\."opening_left_points" IS DISTINCT FROM current_left_points/,
  )
  assert.match(
    migration,
    /available_left_points := NEW\."opening_left_points"[\s\S]*NEW\."source_points"/,
  )
  assert.match(
    migration,
    /LEAST\(available_left_points, available_right_points\) \/ NEW\."points_per_pair"/,
  )
  assert.match(
    migration,
    /NEW\."closing_left_points" IS DISTINCT FROM[\s\S]*available_left_points - NEW\."consumed_left_points"/,
  )
})

test('package binary rejects fabricated opposite-leg carryover and seals the applied closing state', () => {
  // Regression for the concrete exploit: the real profile is 0/0, but an
  // insert claims 0/600 so a single new 600-point left source appears paired.
  const actualOpening = { left: 0, right: 0 }
  const fabricatedOpening = { left: 0, right: 600 }
  const sourcePoints = 600
  const fabricatedCompletedPairs = Math.floor(
    Math.min(fabricatedOpening.left + sourcePoints, fabricatedOpening.right) /
      600,
  )
  assert.equal(fabricatedCompletedPairs, 1)
  assert.notEqual(fabricatedOpening.right, actualOpening.right)

  assert.doesNotMatch(migration, /FOR UPDATE OF profile, package, recipient/)
  assert.match(
    migration,
    /NEW\."opening_right_points" IS DISTINCT FROM current_right_points/,
  )
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "binary_pair_events_validate_closing_state"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(
    migration,
    /applied_left_points IS DISTINCT FROM NEW\."closing_left_points"/,
  )
  assert.match(
    migration,
    /applied_daily_pairing_count IS DISTINCT FROM NEW\."closing_daily_pairing_count"/,
  )

  for (const field of [
    'opening_left_points',
    'opening_right_points',
    'closing_left_points',
    'closing_right_points',
    'pairing_day',
    'opening_daily_pairing_count',
    'closing_daily_pairing_count',
  ]) {
    assert.match(prismaSchema, new RegExp(`\\b${field}\\b`))
  }
})

test('application inserts exact package pair evidence before mutating profile carryover', () => {
  const eventInsert = binaryCommission.indexOf(
    'await tx.binaryPairEvent.create({',
  )
  const profileMutation = binaryCommission.indexOf(
    'await tx.resellerProfile.update({',
    eventInsert,
  )

  assert.ok(eventInsert >= 0)
  assert.ok(profileMutation > eventInsert)
  assert.match(
    binaryCommission.slice(eventInsert, profileMutation),
    /opening_left_points: openingLeftPoints[\s\S]*closing_right_points: rightPoints/,
  )
  assert.match(
    migration,
    /NEW\."payable_pairs" IS DISTINCT FROM expected_payable_pairs/,
  )
  assert.match(
    migration,
    /NEW\."cap_flashout_pairs" IS DISTINCT FROM expected_cap_flashout_pairs/,
  )
  assert.match(
    binaryCommission,
    /SELECT id, user_id, parent_id, position, depth[\s\S]*ORDER BY depth ASC/,
  )
})

test('no-pair package volume is still immutable and exact on either source leg', () => {
  const applyUnmatchedVolume = (leg: 'left' | 'right') => {
    const opening = { left: 0, right: 0 }
    const sourcePoints = 400
    const available = {
      left: opening.left + (leg === 'left' ? sourcePoints : 0),
      right: opening.right + (leg === 'right' ? sourcePoints : 0),
    }
    const pairs = Math.floor(Math.min(available.left, available.right) / 600)
    return { ...available, pairs }
  }

  assert.deepEqual(applyUnmatchedVolume('left'), {
    left: 400,
    right: 0,
    pairs: 0,
  })
  assert.deepEqual(applyUnmatchedVolume('right'), {
    left: 0,
    right: 400,
    pairs: 0,
  })
  assert.doesNotMatch(
    binaryCommission,
    /if \(completedPairs === 0\)[\s\S]{0,300}continue/,
  )
  assert.match(
    migration,
    /NEW\."completed_pairs" IS DISTINCT FROM \(CASE[\s\S]*WHEN NEW\."points_per_pair" > 0[\s\S]*ELSE 0/,
  )
  assert.match(
    binaryCommission,
    /if \(completedPairs > 0\) \{[\s\S]*await tx\.pairingLog\.create/,
  )
})

test('package settlement commit requires one exact volume event for every eligible ancestor', () => {
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "binary_settlement_events_validate_completeness"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(
    migration,
    /expected_recipients AS \([\s\S]*JOIN "reseller_profiles" profile/,
  )
  assert.match(
    migration,
    /SELECT expected\."user_id" FROM expected_recipients expected[\s\S]*EXCEPT[\s\S]*SELECT recorded\."user_id" FROM recorded_recipients recorded/,
  )
  assert.match(
    migration,
    /SELECT recorded\."user_id" FROM recorded_recipients recorded[\s\S]*EXCEPT[\s\S]*SELECT expected\."user_id" FROM expected_recipients expected/,
  )
  assert.match(
    migration,
    /does not contain one exact volume event for every eligible ancestor/,
  )
})

test('every paid positive registration or upgrade source must commit one exact settlement', () => {
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "registration_financials_require_binary_settlement"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(
    migration,
    /NEW\."payment_status" = 'paid' AND NEW\."binary_points_per_pair" > 0[\s\S]*event\."source_kind" = 'registration'[\s\S]*event\."source_event_id" = NEW\."pin_id"[\s\S]*event\."source_user_id" = NEW\."reseller_id"[\s\S]*event\."source_points" = NEW\."binary_points_per_pair"/,
  )
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "upgrade_financials_require_binary_settlement"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(
    migration,
    /NEW\."payment_status" = 'paid' AND NEW\."binary_points_difference" > 0[\s\S]*event\."source_kind" = 'upgrade'[\s\S]*event\."source_event_id" = NEW\."upgrade_pin_id"[\s\S]*event\."source_user_id" = NEW\."reseller_id"[\s\S]*event\."source_points" = NEW\."binary_points_difference"/,
  )
})

test('Product Binary requires a paid delivered reseller commerce order with exact item totals', () => {
  assert.match(
    migration,
    /BEFORE INSERT ON "product_binary_order_events"/,
  )
  assert.match(migration, /source_order\.buyer_role IS DISTINCT FROM 'reseller'/)
  assert.match(migration, /source_order\.order_status IS DISTINCT FROM 'delivered'/)
  assert.match(migration, /source_order\.payment_status IS DISTINCT FROM 'paid'/)
  assert.match(migration, /source_order\.financial_purpose IS DISTINCT FROM 'commerce'/)
  assert.match(migration, /NEW\."total_pu" IS DISTINCT FROM source_order\.total_pu/)
  assert.match(
    migration,
    /NEW\."recorded_gross_margin" IS DISTINCT FROM source_order\.recorded_gross_margin/,
  )
})

test('Product Binary commission must map one-to-one to the exact ancestor pair and order', () => {
  assert.match(
    migration,
    /product_binary_pair_events" pair_event[\s\S]*product_binary_order_events" order_event/,
  )
  assert.match(migration, /pair_event\."normal_commission_id" = NEW\."id"/)
  assert.match(migration, /pair_event\."recipient_user_id" = NEW\."user_id"/)
  assert.match(migration, /pair_event\."source_user_id" = NEW\."source_user_id"/)
  assert.match(migration, /order_event\."order_id" = NEW\."source_event_id"/)
  assert.match(migration, /Product Binary recipient is not an ancestor on the source order leg/)
  assert.match(migration, /FROM "product_binary_positions" position[\s\S]*FOR UPDATE/)
  assert.match(migration, /NEW\."opening_left_pu" IS DISTINCT FROM current_left_pu/)
  assert.match(migration, /NEW\."opening_right_pu" IS DISTINCT FROM current_right_pu/)
  assert.match(migration, /NEW\."opening_lifetime_pairs" IS DISTINCT FROM current_lifetime_pairs/)
  assert.match(
    migration,
    /NEW\."completed_pairs" IS DISTINCT FROM LEAST\(available_left_pu, available_right_pu\) \/ 2/,
  )
  assert.match(migration, /NEW\."closing_left_pu" IS DISTINCT FROM available_left_pu - NEW\."completed_pairs" \* 2/)
  assert.match(migration, /NEW\."closing_lifetime_pairs" IS DISTINCT FROM current_lifetime_pairs \+ NEW\."completed_pairs"/)
  assert.match(migration, /expected_pair_rate_amount := LEAST\(configured_rate_points \* 0\.5, 20\.00\)/)
})

test('Product Binary records zero-pair volume on both legs before position mutation', () => {
  const applyUnmatchedPu = (leg: 'left' | 'right') => {
    const opening = { left: 0, right: 0 }
    const sourcePu = 1
    const available = {
      left: opening.left + (leg === 'left' ? sourcePu : 0),
      right: opening.right + (leg === 'right' ? sourcePu : 0),
    }
    return {
      ...available,
      pairs: Math.floor(Math.min(available.left, available.right) / 2),
    }
  }

  assert.deepEqual(applyUnmatchedPu('left'), { left: 1, right: 0, pairs: 0 })
  assert.deepEqual(applyUnmatchedPu('right'), { left: 0, right: 1, pairs: 0 })
  assert.doesNotMatch(
    productBinary,
    /if \(completedPairs <= 0\)[\s\S]{0,300}continue/,
  )

  const eventInsert = productBinary.indexOf(
    'INSERT INTO product_binary_pair_events(',
  )
  const positionMutation = productBinary.indexOf(
    'UPDATE product_binary_positions SET left_carryover_pu=',
    eventInsert,
  )
  assert.ok(eventInsert >= 0)
  assert.ok(positionMutation > eventInsert)
  assert.match(
    productBinary.slice(eventInsert, positionMutation),
    /opening_lifetime_pairs[\s\S]*closing_lifetime_flashout/,
  )
})

test('Product Binary closing verifier prevents reuse of already-consumed carryover', () => {
  // A real 0/2 opening plus 2 PU on the left closes at 0/0. Leaving the
  // position at 0/2 would let a later left source spend the same right PU again.
  const opening = { left: 0, right: 2 }
  const available = { left: opening.left + 2, right: opening.right }
  const pairs = Math.floor(Math.min(available.left, available.right) / 2)
  const closing = {
    left: available.left - pairs * 2,
    right: available.right - pairs * 2,
  }
  assert.deepEqual(closing, { left: 0, right: 0 })
  assert.notDeepEqual(opening, closing)

  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "product_binary_pair_events_validate_closing_state"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(
    migration,
    /applied_right_pu IS DISTINCT FROM NEW\."closing_right_pu"/,
  )
  assert.match(
    migration,
    /applied_lifetime_flashout IS DISTINCT FROM NEW\."closing_lifetime_flashout"/,
  )

  for (const field of [
    'opening_lifetime_pairs',
    'opening_lifetime_payable',
    'opening_lifetime_flashout',
    'closing_lifetime_pairs',
    'closing_lifetime_payable',
    'closing_lifetime_flashout',
  ]) {
    assert.match(prismaSchema, new RegExp(`\\b${field}\\b`))
  }
})

test('Product Binary order event cannot omit any eligible ancestor volume row', () => {
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "product_binary_order_events_validate_completeness"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(
    migration,
    /Product Binary order event does not contain one exact volume event for every eligible ancestor/,
  )
  assert.match(
    migration,
    /recorded_recipients AS \([\s\S]*FROM "product_binary_pair_events" event[\s\S]*event\."order_event_id" = NEW\."id"/,
  )
})

test('company-retained binary commissions have one exact Hiroma pair lineage', () => {
  assert.match(
    migration,
    /event\."flashout_commission_id" = NEW\."id"[\s\S]*Retained Package Binary commission has no exact immutable pair entitlement/,
  )
  assert.match(
    migration,
    /pair_event\."flashout_commission_id" = NEW\."id"[\s\S]*Retained Product Binary commission has no exact immutable pair entitlement/,
  )
  assert.match(migration, /hiroma\."username" = 'hiroma'[\s\S]*hiroma\."role" = 'admin'::"Role"/)
  assert.match(migration, /NEW\."overflow_to" = NEW\."user_id"/)
  assert.match(
    migration,
    /NEW\."type" = 'deactivation_wallet_transfer'::"CommissionType"[\s\S]*event\."reseller_id" = NEW\."source_user_id"[\s\S]*event\."wallet_value" = NEW\."amount"/,
  )
})

test('retained direct referral is source-bounded but documents its cap-decision residual', () => {
  assert.match(migration, /NEW\."amount" > direct_source_allocation/)
  assert.match(
    migration,
    /direct_paid_amount IS DISTINCT FROM direct_source_allocation - direct_retained_amount|direct_retained_amount IS DISTINCT FROM direct_source_allocation - direct_paid_amount/,
  )
  assert.match(migration, /Direct referral paid and retained evidence does not exactly exhaust one sealed allocation/)
  assert.match(migration, /Retained direct-referral evidence is non-spendable/)
  assert.match(migration, /exact daily-cap[\s\S]*cannot be reconstructed without a dedicated immutable event/)
})

test('zero-PU completion remains outside the event entitlement boundary', () => {
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "product_binary_jobs_validate_completion"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(
    migration,
    /Zero-PU orders remain supported:[\s\S]*without inserting an order event/,
  )
  assert.match(
    migration,
    /source_order\.total_pu > 0[\s\S]*exact_order_event_count IS DISTINCT FROM 1/,
  )
  assert.match(
    migration,
    /source_order\.total_pu <= 0[\s\S]*exact_order_event_count IS DISTINCT FROM 0/,
  )
})
