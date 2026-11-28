ALTER TABLE "ShopOrder" ADD COLUMN "recognizedSale" BOOLEAN, ADD COLUMN "stockReturnedAt" TIMESTAMP(3);
UPDATE "ShopOrder" SET "recognizedSale" = true WHERE status = 'PAID';
UPDATE "ShopOrder" SET "recognizedSale" = false WHERE status = 'CANCELED' AND "paidAt" IS NOT NULL;
CREATE INDEX "ShopOrder_tenantId_stockReturnedAt_idx" ON "ShopOrder"("tenantId","stockReturnedAt");
