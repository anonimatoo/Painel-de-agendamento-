ALTER TABLE "Tenant" ADD COLUMN "consumerNoticeHours" INTEGER;
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_consumerNoticeHours_check" CHECK ("consumerNoticeHours" BETWEEN 0 AND 720);

CREATE TABLE "ConsumerProfile" (
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    CONSTRAINT "ConsumerProfile_pkey" PRIMARY KEY ("tenantId", "userId"),
    CONSTRAINT "ConsumerProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsumerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConsumerProfile_userId_idx" ON "ConsumerProfile"("userId");

ALTER TABLE "Appointment" ADD COLUMN "consumerUserId" TEXT;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_consumerUserId_fkey" FOREIGN KEY ("tenantId", "consumerUserId") REFERENCES "ConsumerProfile"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Appointment_tenantId_consumerUserId_startsAt_idx" ON "Appointment"("tenantId", "consumerUserId", "startsAt");

ALTER TABLE "ShopOrder" ADD COLUMN "consumerUserId" TEXT;
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_tenantId_consumerUserId_fkey" FOREIGN KEY ("tenantId", "consumerUserId") REFERENCES "ConsumerProfile"("tenantId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ShopOrder_tenantId_consumerUserId_createdAt_idx" ON "ShopOrder"("tenantId", "consumerUserId", "createdAt");
