ALTER TABLE "Tenant"
    ADD COLUMN "connectAttemptAt" TIMESTAMP(3),
    ADD COLUMN "connectAttemptEmail" TEXT,
    ADD COLUMN "connectAttemptScope" TEXT;
