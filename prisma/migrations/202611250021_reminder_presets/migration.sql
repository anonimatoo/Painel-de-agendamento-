ALTER TABLE "Tenant" ADD COLUMN "reminderPresets" INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN "completionMessages" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "reviewUrl" TEXT;
ALTER TABLE "Tenant" ADD CHECK ("reminderPresets" <@ ARRAY[120, 1440, 2880]);
ALTER TABLE "Reminder" DROP CONSTRAINT "Reminder_kind_check";
ALTER TABLE "Reminder" ADD CHECK (kind IN ('REMINDER','CONFIRMED','PAID','CANCELED','RESCHEDULED','PAYMENT_PENDING','COMPLETED','FEEDBACK'));
DROP INDEX "Reminder_appointmentId_runAt_key";
CREATE UNIQUE INDEX "Reminder_appointmentId_runAt_kind_key" ON "Reminder"("appointmentId", "runAt", kind);
