-- CreateTable
CREATE TABLE "CommercialRule" (
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "hour" INTEGER NOT NULL,
    "leadDays" INTEGER NOT NULL,
    "template" TEXT NOT NULL,

    CONSTRAINT "CommercialRule_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "CommercialNotice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "invoiceId" TEXT,
    "subscriptionId" TEXT,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "claimedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "planName" TEXT,
    "cents" INTEGER,
    "dueAt" TIMESTAMP(3),

    CONSTRAINT "CommercialNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommercialNotice_state_sendAt_idx" ON "CommercialNotice"("state", "sendAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialNotice_tenantId_kind_reference_key" ON "CommercialNotice"("tenantId", "kind", "reference");

-- AddForeignKey
ALTER TABLE "CommercialNotice" ADD CONSTRAINT "CommercialNotice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "CommercialRule" ADD CHECK (hour BETWEEN 0 AND 23 AND "leadDays" BETWEEN 0 AND 60);
ALTER TABLE "CommercialNotice" ADD CHECK (state IN ('QUEUED','SENDING','SENT','REVIEW','FAILED','CANCELED'));
