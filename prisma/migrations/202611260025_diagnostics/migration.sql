CREATE TABLE "EvolutionSetting" (id INTEGER PRIMARY KEY CHECK (id = 1), endpoint TEXT NOT NULL,
  "encryptedKey" TEXT NOT NULL, "qrEnabled" BOOLEAN NOT NULL DEFAULT false, "checkedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "WorkerHeartbeat" (id INTEGER PRIMARY KEY CHECK (id = 1), "seenAt" TIMESTAMP(3) NOT NULL);
