import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  'prisma/migrations/20260902147000_atomic_binary_tree_descendant_counts/migration.sql',
  'utf8',
)

test('legacy descendant counts are rebuilt from immutable placement paths', () => {
  assert.match(migration, /WITH RECURSIVE descendant_paths AS/)
  assert.match(migration, /path\.source_leg/)
  assert.match(migration, /COUNT\(path\.descendant_id\) FILTER \(WHERE path\.source_leg = 'left'\)/)
  assert.match(migration, /COUNT\(path\.descendant_id\) FILTER \(WHERE path\.source_leg = 'right'\)/)
  assert.match(migration, /IS DISTINCT FROM \(exact\.left_count, exact\.right_count\)/)
})

test('malformed or cyclic legacy placement aborts instead of fabricating counts', () => {
  assert.match(migration, /\(node\."parent_id" IS NULL\) <> \(node\."position" IS NULL\)/)
  assert.match(migration, /node\."id" = node\."parent_id"/)
  assert.match(migration, /NOT EXISTS \([\s\S]*parent\."id" = node\."parent_id"/)
  assert.match(migration, /WITH RECURSIVE parent_walk AS/)
  assert.match(migration, /RAISE EXCEPTION 'Binary-tree cycle exists/)
  assert.match(migration, /binary_tree_nodes_parent_position_shape_check/)
})

test('new placements atomically increment every ancestor root-first', () => {
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION "maintain_binary_tree_ancestor_counts"/)
  assert.match(migration, /SECURITY DEFINER/)
  assert.match(migration, /NEW\."position"::text AS source_leg/)
  assert.match(migration, /child\."position"::text AS source_leg/)
  assert.match(migration, /ORDER BY depth DESC/)
  assert.match(migration, /SET "left_count" = "left_count" \+ 1/)
  assert.match(migration, /SET "right_count" = "right_count" \+ 1/)
  assert.match(
    migration,
    /CREATE TRIGGER "binary_tree_nodes_maintain_ancestor_counts"\s+AFTER INSERT ON "binary_tree_nodes"\s+FOR EACH ROW/,
  )
  assert.match(migration, /ENABLE ALWAYS TRIGGER "binary_tree_nodes_maintain_ancestor_counts"/)
  assert.match(migration, /IF NOT parent_was_updated THEN/)
})

test('callers cannot inject leaf counts or mutate derived counts directly', () => {
  assert.match(migration, /NEW\."left_count" <> 0 OR NEW\."right_count" <> 0/)
  assert.match(
    migration,
    /CREATE TRIGGER "binary_tree_nodes_validate_leaf_insert"\s+BEFORE INSERT ON "binary_tree_nodes"/,
  )
  assert.match(migration, /current_setting\('hiroma\.binary_tree_count_maintenance', true\) = 'on'/)
  assert.match(migration, /pg_trigger_depth\(\) > 1/)
  assert.match(migration, /descendant counts are maintained only by placement insertion/)
})

test('financial settlement derives ancestry from placement, never descendant counters', () => {
  for (const sourcePath of [
    'src/app/lib/binaryCommission.ts',
    'src/app/lib/productBinary.ts',
  ]) {
    const source = readFileSync(sourcePath, 'utf8')
    assert.match(source, /WITH RECURSIVE/)
    assert.match(source, /parent_id/)
    assert.doesNotMatch(source, /left_count|right_count/)
  }
})
