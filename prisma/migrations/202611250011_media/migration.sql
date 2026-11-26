-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('LOGO', 'BANNER', 'COVER', 'PROFESSIONAL', 'SERVICE', 'PRODUCT', 'GALLERY');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "policies" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'light';

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "target" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_key_key" ON "MediaAsset"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_tenantId_kind_target_key" ON "MediaAsset"("tenantId", "kind", "target");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Tenant" ADD CHECK (theme IN ('light', 'dark'));
ALTER TABLE "MediaAsset" ADD CHECK (bytes > 0 AND bytes <= 4000000);
