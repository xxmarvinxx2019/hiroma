-- left_count/right_count are derived dashboard values. Package Binary and
-- Product Binary settlement never use them: financial ancestry comes from the
-- immutable parent_id/position chain and separate point/carryover ledgers.
-- Keep these derived values exact anyway by rebuilding them once, then making
-- every future placement update its ancestors inside the INSERT transaction.

-- Keep reconciliation, trigger installation, and direct-write sealing as one
-- deployment boundary. Old application instances can neither miss nor
-- double-apply a count while the migration is being installed.
BEGIN;

-- The rebuild and trigger installation must see one stable placement set.
-- Without this lock, a node inserted after the recursive snapshot but before
-- trigger installation could commit without ever reaching ancestor counts.
LOCK TABLE "binary_tree_nodes" IN SHARE ROW EXCLUSIVE MODE;

-- Abort instead of attempting to infer intent from malformed legacy rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "binary_tree_nodes" node
     WHERE (node."parent_id" IS NULL) <> (node."position" IS NULL)
        OR node."id" = node."parent_id"
        OR (
          node."parent_id" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM "binary_tree_nodes" parent
             WHERE parent."id" = node."parent_id"
          )
        )
  ) THEN
    RAISE EXCEPTION 'Binary-tree parent/position shape is invalid; reconcile it before enabling atomic descendant counts.';
  END IF;

  IF EXISTS (
    WITH RECURSIVE parent_walk AS (
      SELECT node."id" AS origin_id,
             node."parent_id" AS next_parent_id,
             ARRAY[node."id"]::text[] AS visited,
             false AS has_cycle
        FROM "binary_tree_nodes" node
      UNION ALL
      SELECT walk.origin_id,
             parent."parent_id",
             walk.visited || parent."id",
             parent."id" = ANY(walk.visited)
        FROM parent_walk walk
        JOIN "binary_tree_nodes" parent
          ON parent."id" = walk.next_parent_id
       WHERE NOT walk.has_cycle
    )
    SELECT 1 FROM parent_walk WHERE has_cycle
  ) THEN
    RAISE EXCEPTION 'Binary-tree cycle exists; reconcile it before enabling atomic descendant counts.';
  END IF;
END $$;

-- Reconcile every existing counter from immutable placement truth. This is
-- intentionally done while migration 1460 still permits derived-count repair.
WITH RECURSIVE descendant_paths AS (
  SELECT parent."id" AS ancestor_id,
         child."id" AS descendant_id,
         child."position"::text AS source_leg
    FROM "binary_tree_nodes" parent
    JOIN "binary_tree_nodes" child
      ON child."parent_id" = parent."id"
  UNION ALL
  SELECT path.ancestor_id,
         child."id",
         path.source_leg
    FROM descendant_paths path
    JOIN "binary_tree_nodes" child
      ON child."parent_id" = path.descendant_id
), exact_counts AS (
  SELECT node."id",
         COALESCE(COUNT(path.descendant_id) FILTER (WHERE path.source_leg = 'left'), 0)::integer AS left_count,
         COALESCE(COUNT(path.descendant_id) FILTER (WHERE path.source_leg = 'right'), 0)::integer AS right_count
    FROM "binary_tree_nodes" node
    LEFT JOIN descendant_paths path
      ON path.ancestor_id = node."id"
   GROUP BY node."id"
)
UPDATE "binary_tree_nodes" node
   SET "left_count" = exact.left_count,
       "right_count" = exact.right_count
  FROM exact_counts exact
 WHERE node."id" = exact."id"
   AND (node."left_count", node."right_count")
       IS DISTINCT FROM (exact.left_count, exact.right_count);

ALTER TABLE "binary_tree_nodes"
  ADD CONSTRAINT "binary_tree_nodes_parent_position_shape_check"
  CHECK (
    ("parent_id" IS NULL AND "position" IS NULL)
    OR ("parent_id" IS NOT NULL AND "position" IS NOT NULL AND "id" <> "parent_id")
  ) NOT VALID;
ALTER TABLE "binary_tree_nodes"
  VALIDATE CONSTRAINT "binary_tree_nodes_parent_position_shape_check";

ALTER TABLE "binary_tree_nodes"
  ADD CONSTRAINT "binary_tree_nodes_descendant_counts_nonnegative_check"
  CHECK ("left_count" >= 0 AND "right_count" >= 0) NOT VALID;
ALTER TABLE "binary_tree_nodes"
  VALIDATE CONSTRAINT "binary_tree_nodes_descendant_counts_nonnegative_check";

-- A new node cannot already have descendants. Reject caller-supplied counts so
-- the AFTER INSERT trigger remains the sole creator of derived count changes.
CREATE OR REPLACE FUNCTION "validate_binary_tree_leaf_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."left_count" <> 0 OR NEW."right_count" <> 0 THEN
    RAISE EXCEPTION 'A newly placed binary-tree node must start with zero descendant counts.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "binary_tree_nodes_validate_leaf_insert"
  ON "binary_tree_nodes";
CREATE TRIGGER "binary_tree_nodes_validate_leaf_insert"
BEFORE INSERT ON "binary_tree_nodes"
FOR EACH ROW EXECUTE FUNCTION "validate_binary_tree_leaf_insert"();
ALTER TABLE "binary_tree_nodes"
ENABLE ALWAYS TRIGGER "binary_tree_nodes_validate_leaf_insert";

-- Lock/update ancestors root-first. Concurrent placements that share ancestry
-- therefore take row locks in the same order, avoiding drift and minimizing
-- deadlock risk. Any failure aborts the placement transaction as one unit.
CREATE OR REPLACE FUNCTION "maintain_binary_tree_ancestor_counts"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  ancestor_row RECORD;
  previous_maintenance_setting text;
  parent_was_updated boolean := false;
BEGIN
  IF NEW."parent_id" IS NULL THEN
    RETURN NEW;
  END IF;

  previous_maintenance_setting := current_setting(
    'hiroma.binary_tree_count_maintenance',
    true
  );
  PERFORM set_config('hiroma.binary_tree_count_maintenance', 'on', true);

  BEGIN
    FOR ancestor_row IN
      WITH RECURSIVE ancestor_chain AS (
        SELECT parent."id",
               parent."parent_id",
               parent."position",
               NEW."position"::text AS source_leg,
               0 AS depth
          FROM "binary_tree_nodes" parent
         WHERE parent."id" = NEW."parent_id"
        UNION ALL
        SELECT parent."id",
               parent."parent_id",
               parent."position",
               child."position"::text AS source_leg,
               child.depth + 1
          FROM ancestor_chain child
          JOIN "binary_tree_nodes" parent
            ON parent."id" = child."parent_id"
      )
      SELECT "id", source_leg
        FROM ancestor_chain
       ORDER BY depth DESC
    LOOP
      parent_was_updated := true;
      IF ancestor_row.source_leg = 'left' THEN
        UPDATE "binary_tree_nodes"
           SET "left_count" = "left_count" + 1
         WHERE "id" = ancestor_row."id";
      ELSIF ancestor_row.source_leg = 'right' THEN
        UPDATE "binary_tree_nodes"
           SET "right_count" = "right_count" + 1
         WHERE "id" = ancestor_row."id";
      ELSE
        RAISE EXCEPTION 'Binary-tree ancestor leg is missing during descendant-count maintenance.'
          USING ERRCODE = '23514';
      END IF;
    END LOOP;

    IF NOT parent_was_updated THEN
      RAISE EXCEPTION 'Binary-tree parent is unavailable during descendant-count maintenance.'
        USING ERRCODE = '23503';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'hiroma.binary_tree_count_maintenance',
      COALESCE(NULLIF(previous_maintenance_setting, ''), 'off'),
      true
    );
    RAISE;
  END;

  PERFORM set_config(
    'hiroma.binary_tree_count_maintenance',
    COALESCE(NULLIF(previous_maintenance_setting, ''), 'off'),
    true
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "binary_tree_nodes_maintain_ancestor_counts"
  ON "binary_tree_nodes";
CREATE TRIGGER "binary_tree_nodes_maintain_ancestor_counts"
AFTER INSERT ON "binary_tree_nodes"
FOR EACH ROW EXECUTE FUNCTION "maintain_binary_tree_ancestor_counts"();
ALTER TABLE "binary_tree_nodes"
ENABLE ALWAYS TRIGGER "binary_tree_nodes_maintain_ancestor_counts";

-- Extend migration 1460's placement seal: identity remains immutable, and
-- derived counters can now change only as a nested operation of the trusted
-- AFTER INSERT maintenance trigger above.
CREATE OR REPLACE FUNCTION "protect_binary_tree_placement_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Binary-tree placement records cannot be deleted or truncated.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR NEW."parent_id" IS DISTINCT FROM OLD."parent_id"
     OR NEW."position" IS DISTINCT FROM OLD."position"
     OR NEW."sponsor_id" IS DISTINCT FROM OLD."sponsor_id"
     OR NEW."is_overflow" IS DISTINCT FROM OLD."is_overflow"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Binary-tree placement identity is immutable after insertion.'
      USING ERRCODE = '55000';
  END IF;

  IF (
       NEW."left_count" IS DISTINCT FROM OLD."left_count"
       OR NEW."right_count" IS DISTINCT FROM OLD."right_count"
     )
     AND NOT (
       pg_trigger_depth() > 1
       AND current_setting('hiroma.binary_tree_count_maintenance', true) = 'on'
     ) THEN
    RAISE EXCEPTION 'Binary-tree descendant counts are maintained only by placement insertion.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "validate_binary_tree_leaf_insert"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "maintain_binary_tree_ancestor_counts"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "protect_binary_tree_placement_identity"() FROM PUBLIC;

COMMIT;
