CREATE TABLE "MediaCleanup" (
  "key" TEXT PRIMARY KEY,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MediaCleanup_nextAt_idx" ON "MediaCleanup"("nextAt");
