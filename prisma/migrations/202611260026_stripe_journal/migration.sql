-- CreateTable
CREATE TABLE "StripeMovement" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "stripeId" TEXT NOT NULL,
    "sourceId" TEXT,
    "customerId" TEXT,
    "intentId" TEXT,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "gross" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StripeMovement_scope_stripeId_recordedAt_idx" ON "StripeMovement"("scope", "stripeId", "recordedAt");

-- CreateIndex
CREATE INDEX "StripeMovement_scope_occurredAt_idx" ON "StripeMovement"("scope", "occurredAt");

