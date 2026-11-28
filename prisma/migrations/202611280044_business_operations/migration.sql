ALTER TABLE "ShopOrder" ADD COLUMN "offerId" TEXT, ADD COLUMN "offerSelection" TEXT;
ALTER TABLE "ShopOrderItem" ADD COLUMN "unitCostCents" INTEGER;
ALTER TABLE "ShopOrderItem" ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProfessionalCommission" ADD COLUMN "paymentReference" TEXT;
CREATE UNIQUE INDEX "FinancialEntry_tenantId_id_key" ON "FinancialEntry"("tenantId","id");

CREATE TABLE "Supplier" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "contact" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Supplier_tenantId_id_key" ON "Supplier"("tenantId","id");
CREATE UNIQUE INDEX "Supplier_tenantId_name_key" ON "Supplier"("tenantId","name");

CREATE TABLE "Purchase" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "unitCostCents" INTEGER NOT NULL CHECK ("unitCostCents" > 0),
  "requestId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expenseId" TEXT NOT NULL,
  CONSTRAINT "Purchase_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId","supplierId") REFERENCES "Supplier"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Purchase_tenantId_productId_fkey" FOREIGN KEY ("tenantId","productId") REFERENCES "Product"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Purchase_tenantId_expenseId_fkey" FOREIGN KEY ("tenantId","expenseId") REFERENCES "FinancialEntry"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Purchase_expenseId_key" ON "Purchase"("expenseId");
CREATE UNIQUE INDEX "Purchase_tenantId_expenseId_key" ON "Purchase"("tenantId","expenseId");
CREATE UNIQUE INDEX "Purchase_tenantId_requestId_key" ON "Purchase"("tenantId","requestId");
CREATE INDEX "Purchase_tenantId_receivedAt_idx" ON "Purchase"("tenantId","receivedAt");

CREATE TABLE "CommercialOffer" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('COUPON','COMBO','PROMOTION')),
  "name" TEXT NOT NULL,
  "code" TEXT,
  "bps" INTEGER NOT NULL CHECK ("bps" BETWEEN 1 AND 9900),
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "productId" TEXT,
  "items" JSONB,
  CONSTRAINT "CommercialOffer_tenantId_productId_fkey" FOREIGN KEY ("tenantId","productId") REFERENCES "Product"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommercialOffer_tenantId_code_key" ON "CommercialOffer"("tenantId","code");
CREATE INDEX "CommercialOffer_tenantId_kind_enabled_startsAt_endsAt_idx" ON "CommercialOffer"("tenantId","kind","enabled","startsAt","endsAt");
CREATE UNIQUE INDEX "CommercialOffer_tenantId_id_key" ON "CommercialOffer"("tenantId","id");
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_tenantId_offerId_fkey" FOREIGN KEY ("tenantId","offerId") REFERENCES "CommercialOffer"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
