-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "professionalId" TEXT;

-- CreateTable
CREATE TABLE "TeamInvite" (
    "tokenHash" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "professionalId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "TeamEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_tenantId_email_key" ON "TeamInvite"("tenantId", "email");

-- CreateIndex
CREATE INDEX "TeamEvent_tenantId_createdAt_idx" ON "TeamEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Member_tenantId_professionalId_key" ON "Member"("tenantId", "professionalId");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_tenantId_professionalId_fkey" FOREIGN KEY ("tenantId", "professionalId") REFERENCES "Professional"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_tenantId_professionalId_fkey" FOREIGN KEY ("tenantId", "professionalId") REFERENCES "Professional"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEvent" ADD CONSTRAINT "TeamEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "TeamInvite" ADD CHECK (role <> 'ADMIN' AND ((role = 'PROFESSIONAL') = ("professionalId" IS NOT NULL)));
