DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "binary_tree_nodes"
    WHERE "parent_id" IS NOT NULL AND "position" IS NOT NULL
    GROUP BY "parent_id", "position"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate binary-tree slots exist; reconcile them before enabling slot uniqueness.';
  END IF;
END $$;

CREATE UNIQUE INDEX "binary_tree_nodes_parent_id_position_key"
ON "binary_tree_nodes" ("parent_id", "position");
