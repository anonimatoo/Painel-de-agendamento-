ALTER TABLE "Reminder" ADD COLUMN "deliveryState" TEXT NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryAt" TIMESTAMP(3),
  ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "Reminder" ADD CHECK ("deliveryState" IN ('QUEUED','SENDING','SENT','REVIEW','FAILED','CANCELED'));
UPDATE "Reminder" SET "deliveryState" = 'SENT' WHERE "sentAt" IS NOT NULL;
UPDATE "Reminder" SET "deliveryState" = 'REVIEW' WHERE "sentAt" IS NULL AND "claimedAt" IS NOT NULL;
