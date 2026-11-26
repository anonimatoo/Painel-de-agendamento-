-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "platformFeeBps" INTEGER,
ADD COLUMN     "platformFeeFixed" INTEGER;

-- AlterTable
ALTER TABLE "Professional" ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionFixed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "platformFeeCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "platformFeeBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "platformFeeFixed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ShopOrder" ADD COLUMN     "platformFeeCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProfessionalCommission" (
    "appointmentId" TEXT NOT NULL,
    "cents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalCommission_pkey" PRIMARY KEY ("appointmentId")
);

-- AddForeignKey
ALTER TABLE "ProfessionalCommission" ADD CONSTRAINT "ProfessionalCommission_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Tenant" ADD CHECK ("platformFeeBps" BETWEEN 0 AND 10000), ADD CHECK ("platformFeeFixed" >= 0);
ALTER TABLE "Plan" ADD CHECK ("platformFeeBps" BETWEEN 0 AND 10000), ADD CHECK ("platformFeeFixed" >= 0);
ALTER TABLE "Professional" ADD CHECK ("commissionBps" BETWEEN 0 AND 10000), ADD CHECK ("commissionFixed" >= 0);
ALTER TABLE "ProfessionalCommission" ADD CHECK (cents > 0);
ALTER TABLE "Appointment" ADD CHECK ("platformFeeCents" >= 0 AND "platformFeeCents" <= COALESCE("chargeCents", cents));
ALTER TABLE "ShopOrder" ADD CHECK ("platformFeeCents" >= 0 AND "platformFeeCents" <= cents);
