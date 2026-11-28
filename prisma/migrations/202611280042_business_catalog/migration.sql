ALTER TABLE "Tenant" ADD COLUMN "draftBillingCycle" TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_draftBillingCycle_check" CHECK ("draftBillingCycle" IN ('monthly', 'annual'));
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "position" INTEGER;
