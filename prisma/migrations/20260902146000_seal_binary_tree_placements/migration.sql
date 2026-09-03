-- Binary-tree placement is financial provenance: package-binary and Product
-- Binary settlements derive each upline and source leg from this immutable
-- chain. Preserve operational descendant counters, but never allow a placed
-- node to be reassigned, reparented, moved, relabelled, or erased.
BEGIN;

DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'Hiroma financial migrations require PostgreSQL 15 or newer.';
  END IF;
END $$;

LOCK TABLE "binary_tree_nodes" IN SHARE ROW EXCLUSIVE MODE;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "binary_tree_nodes_seal_placement"
  ON "binary_tree_nodes";
CREATE TRIGGER "binary_tree_nodes_seal_placement"
BEFORE UPDATE OR DELETE ON "binary_tree_nodes"
FOR EACH ROW EXECUTE FUNCTION "protect_binary_tree_placement_identity"();
ALTER TABLE "binary_tree_nodes"
ENABLE ALWAYS TRIGGER "binary_tree_nodes_seal_placement";

-- Row-level DELETE triggers do not cover TRUNCATE, so seal that privileged
-- deletion path explicitly as well.
DROP TRIGGER IF EXISTS "binary_tree_nodes_block_truncate"
  ON "binary_tree_nodes";
CREATE TRIGGER "binary_tree_nodes_block_truncate"
BEFORE TRUNCATE ON "binary_tree_nodes"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_binary_tree_placement_identity"();
ALTER TABLE "binary_tree_nodes"
ENABLE ALWAYS TRIGGER "binary_tree_nodes_block_truncate";

REVOKE ALL ON FUNCTION "protect_binary_tree_placement_identity"() FROM PUBLIC;

COMMIT;
