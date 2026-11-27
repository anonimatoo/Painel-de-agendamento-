ALTER TABLE "User"
    ADD COLUMN "mfaPending" TEXT,
    ADD COLUMN "mfaRecoveryIssuedAt" TIMESTAMP(3),
    ADD COLUMN "mfaRecoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
