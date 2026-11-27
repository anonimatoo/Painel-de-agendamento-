ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

CREATE TABLE "SocialIdentity" (
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialIdentity_pkey" PRIMARY KEY ("provider", "subject")
);
CREATE UNIQUE INDEX "SocialIdentity_userId_provider_key" ON "SocialIdentity"("userId", "provider");

CREATE TABLE "SocialProviderSettings" (
    "provider" TEXT PRIMARY KEY,
    "encrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" TEXT NOT NULL
);

CREATE TABLE "SocialAttempt" (
    "stateHash" TEXT PRIMARY KEY,
    "browserHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SocialAttempt_expiresAt_idx" ON "SocialAttempt"("expiresAt");
