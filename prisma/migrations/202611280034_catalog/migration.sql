ALTER TABLE "Product"
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sku" TEXT,
  ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "variantOfId" TEXT;

ALTER TABLE "Service"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");
CREATE INDEX "Product_tenantId_variantOfId_idx" ON "Product"("tenantId", "variantOfId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_variantOfId_fkey"
  FOREIGN KEY ("tenantId", "variantOfId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CatalogCategory" (
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("tenantId", "name"),
  CONSTRAINT "CatalogCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
