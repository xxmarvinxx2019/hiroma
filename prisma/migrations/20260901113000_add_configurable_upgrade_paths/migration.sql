CREATE TABLE "package_upgrade_paths" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "from_package_id" TEXT NOT NULL,
  "to_package_id" TEXT NOT NULL,
  "customer_price" DECIMAL(12,2) NOT NULL,
  "pin_price" DECIMAL(12,2) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "package_upgrade_paths_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "package_upgrade_paths_price_check" CHECK ("customer_price" > 0 AND "pin_price" > 0),
  CONSTRAINT "package_upgrade_paths_distinct_packages_check" CHECK ("from_package_id" <> "to_package_id"),
  CONSTRAINT "package_upgrade_paths_from_package_id_fkey" FOREIGN KEY ("from_package_id") REFERENCES "packages"("id") ON DELETE CASCADE,
  CONSTRAINT "package_upgrade_paths_to_package_id_fkey" FOREIGN KEY ("to_package_id") REFERENCES "packages"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "package_upgrade_paths_from_package_id_to_package_id_key"
  ON "package_upgrade_paths"("from_package_id", "to_package_id");
CREATE INDEX "package_upgrade_paths_to_package_id_is_active_idx"
  ON "package_upgrade_paths"("to_package_id", "is_active");

CREATE TABLE "package_upgrade_products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "upgrade_path_id" UUID NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "package_upgrade_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "package_upgrade_products_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "package_upgrade_products_upgrade_path_id_fkey" FOREIGN KEY ("upgrade_path_id") REFERENCES "package_upgrade_paths"("id") ON DELETE CASCADE,
  CONSTRAINT "package_upgrade_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "package_upgrade_products_upgrade_path_id_product_id_key"
  ON "package_upgrade_products"("upgrade_path_id", "product_id");

CREATE TABLE "pin_upgrade_product_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pin_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "pin_upgrade_product_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pin_upgrade_product_snapshots_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "pin_upgrade_product_snapshots_pin_id_fkey" FOREIGN KEY ("pin_id") REFERENCES "pins"("id") ON DELETE CASCADE,
  CONSTRAINT "pin_upgrade_product_snapshots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "pin_upgrade_product_snapshots_pin_id_product_id_key"
  ON "pin_upgrade_product_snapshots"("pin_id", "product_id");
