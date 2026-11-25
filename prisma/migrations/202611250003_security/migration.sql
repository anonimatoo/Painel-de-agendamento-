ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
CREATE TYPE "TokenPurpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFY');
CREATE TABLE "AccountToken" (
  "tokenHash" TEXT PRIMARY KEY,
  "purpose" "TokenPurpose" NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AccountToken_userId_purpose_key" ON "AccountToken"("userId","purpose");
CREATE INDEX "AccountToken_expiresAt_idx" ON "AccountToken"("expiresAt");
CREATE TABLE "RateLimit" (
  "key" TEXT PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");
CREATE TABLE "AdminAudit" (
  id TEXT PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  action TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");
