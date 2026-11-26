ALTER TABLE "Tenant" ADD COLUMN "depositPercent" INTEGER NOT NULL DEFAULT 100 CHECK ("depositPercent" BETWEEN 1 AND 100);
ALTER TABLE "Appointment" ADD COLUMN "chargeCents" INTEGER CHECK ("chargeCents" >= 0 AND "chargeCents" <= cents),
  ADD COLUMN "paymentIntentId" TEXT UNIQUE, ADD COLUMN "refundedAt" TIMESTAMP(3);
