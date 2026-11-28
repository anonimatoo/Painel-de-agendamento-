ALTER TABLE "Tenant" ADD COLUMN "publicDesign" JSONB, ADD COLUMN "publicDesignDraft" JSONB;
ALTER TABLE "Subscription" ADD COLUMN "recurringCents" INTEGER, ADD COLUMN "recurringInterval" TEXT;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_recurring_check" CHECK (
  ("recurringCents" IS NULL AND "recurringInterval" IS NULL) OR
  ("recurringCents" IS NOT NULL AND "recurringInterval" IS NOT NULL AND "recurringCents" >= 0 AND "recurringInterval" IN ('month', 'year'))
);
