ALTER TABLE "Tenant" ADD COLUMN "whatsappTemplates" JSONB,
  ADD COLUMN "birthdayMessages" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "returnAfterDays" INTEGER;
ALTER TABLE "Tenant" ADD CHECK ("returnAfterDays" BETWEEN 1 AND 365);
ALTER TABLE "Customer" ADD COLUMN "birthMonthDay" TEXT, ADD COLUMN "followupConsentAt" TIMESTAMP(3);
CREATE INDEX "Customer_birthMonthDay_idx" ON "Customer" ("birthMonthDay");
ALTER TABLE "Reminder" ADD COLUMN "dedupeKey" TEXT UNIQUE;
ALTER TABLE "Reminder" DROP CONSTRAINT "Reminder_kind_check";
ALTER TABLE "Reminder" ADD CHECK (kind IN ('REMINDER','CONFIRMED','PAID','CANCELED','RESCHEDULED','PAYMENT_PENDING','COMPLETED','FEEDBACK','BIRTHDAY','RETURN'));
