ALTER TABLE "StripeSettings" ADD COLUMN paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "checkedAt" TIMESTAMP(3), ADD COLUMN "checkSucceeded" BOOLEAN,
  ADD COLUMN "paymentsEnabled" BOOLEAN, ADD COLUMN "payoutsEnabled" BOOLEAN;
