-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED', 'REFUNDED');

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "checkoutId" TEXT,
    "paymentIntentId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrderItem" (
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unitCents" INTEGER NOT NULL,

    CONSTRAINT "ShopOrderItem_pkey" PRIMARY KEY ("orderId","productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_checkoutId_key" ON "ShopOrder"("checkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_paymentIntentId_key" ON "ShopOrder"("paymentIntentId");

-- CreateIndex
CREATE INDEX "ShopOrder_status_expiresAt_idx" ON "ShopOrder"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_tenantId_requestId_key" ON "ShopOrder"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_tenantId_id_key" ON "ShopOrder"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "ShopOrder"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderItem" ADD CONSTRAINT "ShopOrderItem_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ShopOrder" ADD CHECK (cents > 0);
ALTER TABLE "ShopOrderItem" ADD CHECK (quantity > 0 AND "unitCents" > 0);
