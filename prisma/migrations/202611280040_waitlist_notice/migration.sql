ALTER TABLE "WaitEntry"
  ADD COLUMN "notificationConsentAt" TIMESTAMP(3),
  ADD COLUMN "notificationState" TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK ("notificationState" IN ('QUEUED','SENDING','ACCEPTED','REVIEW','FAILED')),
  ADD COLUMN "notificationCheckedAt" TIMESTAMP(3),
  ADD COLUMN "notificationReference" TEXT;

CREATE INDEX "WaitEntry_notificationState_day_notificationCheckedAt_idx"
  ON "WaitEntry"("notificationState", day, "notificationCheckedAt");
