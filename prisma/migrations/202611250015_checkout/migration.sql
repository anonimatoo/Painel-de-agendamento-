ALTER TABLE "Appointment" ADD COLUMN "checkoutReturnUrl" TEXT, ADD COLUMN "checkoutAccountId" TEXT,
  ADD COLUMN "checkoutState" TEXT, ADD COLUMN "paymentToken" TEXT UNIQUE;
ALTER TABLE "Appointment" ADD CHECK ("checkoutState" IN ('CREATING','OPEN','REVIEW','PAID','EXPIRED'));
UPDATE "Appointment" SET "checkoutState" = CASE WHEN "checkoutId" IS NULL THEN 'REVIEW' ELSE 'OPEN' END WHERE status = 'PENDING';
