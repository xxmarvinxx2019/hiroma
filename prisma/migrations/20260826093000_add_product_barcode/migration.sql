ALTER TABLE "products" ADD COLUMN "barcode" TEXT;

CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");
