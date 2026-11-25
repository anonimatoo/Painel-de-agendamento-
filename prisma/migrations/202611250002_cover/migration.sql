ALTER TABLE "Tenant" ADD COLUMN "coverKey" TEXT;
CREATE UNIQUE INDEX "Tenant_coverKey_key" ON "Tenant"("coverKey");
