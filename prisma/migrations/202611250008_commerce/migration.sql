-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('ADJUSTMENT', 'SALE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('INCOME', 'EXPENSE');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "category" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "costCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "minimumStock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promotionCents" INTEGER;

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "MovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCents" INTEGER NOT NULL DEFAULT 0,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_createdAt_idx" ON "StockMovement"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_tenantId_requestId_key" ON "StockMovement"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "FinancialEntry_tenantId_dueAt_idx" ON "FinancialEntry"("tenantId", "dueAt");

-- CreateIndex
CREATE INDEX "FinancialEntry_tenantId_paidAt_idx" ON "FinancialEntry"("tenantId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_id_key" ON "Product"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Product" ADD CHECK ("costCents" >= 0 AND "minimumStock" >= 0 AND ("promotionCents" BETWEEN 1 AND cents OR "promotionCents" IS NULL));
ALTER TABLE "StockMovement" ADD CHECK (quantity <> 0 AND "unitCents" >= 0 AND "unitCostCents" >= 0);
ALTER TABLE "FinancialEntry" ADD CHECK (cents > 0);
