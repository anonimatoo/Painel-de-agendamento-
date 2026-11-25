CREATE TABLE "StripeSettings" (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  "accountId" TEXT NOT NULL,
  "publishableKey" TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  encrypted TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
