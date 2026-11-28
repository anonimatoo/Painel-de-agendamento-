ALTER TABLE "Tenant" ADD COLUMN "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FinancialEntry" ADD COLUMN "classification" TEXT NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "ConsumerProfile" ADD COLUMN "marketingEmail" TEXT, ADD COLUMN "marketingEmailAt" TIMESTAMP(3),
  ADD COLUMN "marketingPhone" TEXT, ADD COLUMN "marketingPhoneAt" TIMESTAMP(3), ADD COLUMN "marketingPhoneCode" TEXT, ADD COLUMN "marketingPhoneCodeUntil" TIMESTAMP(3);

CREATE TABLE "StoreHoliday" (
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "date" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  PRIMARY KEY ("tenantId","date")
);

CREATE TABLE "Campaign" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "channel" TEXT NOT NULL CHECK ("channel" IN ('EMAIL','WHATSAPP')),
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Campaign_tenantId_id_key" ON "Campaign"("tenantId","id");
CREATE INDEX "Campaign_tenantId_createdAt_idx" ON "Campaign"("tenantId","createdAt");
CREATE TABLE "CampaignDelivery" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'QUEUED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  CONSTRAINT "CampaignDelivery_tenantId_campaignId_fkey" FOREIGN KEY ("tenantId","campaignId") REFERENCES "Campaign"("tenantId","id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CampaignDelivery_tenantId_userId_fkey" FOREIGN KEY ("tenantId","userId") REFERENCES "ConsumerProfile"("tenantId","userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CampaignDelivery_campaignId_userId_key" ON "CampaignDelivery"("campaignId","userId");
CREATE INDEX "CampaignDelivery_state_createdAt_idx" ON "CampaignDelivery"("state","createdAt");

CREATE TABLE "LoyaltyReward" (
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId","userId","sequence"),
  CONSTRAINT "LoyaltyReward_tenantId_userId_fkey" FOREIGN KEY ("tenantId","userId") REFERENCES "ConsumerProfile"("tenantId","userId") ON DELETE CASCADE ON UPDATE CASCADE
);
