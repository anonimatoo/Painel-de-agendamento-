-- AlterEnum
ALTER TYPE "Status" ADD VALUE 'NO_SHOW';

-- CreateTable
CREATE TABLE "ScheduleBlock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "ScheduleBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentHistory" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "actorId" TEXT,
    "operation" TEXT NOT NULL,
    "previousStart" TIMESTAMP(3),
    "newStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleBlock_tenantId_professionalId_startsAt_idx" ON "ScheduleBlock"("tenantId", "professionalId", "startsAt");

-- CreateIndex
CREATE INDEX "AppointmentHistory_appointmentId_createdAt_idx" ON "AppointmentHistory"("appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "WaitEntry_tenantId_day_idx" ON "WaitEntry"("tenantId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "WaitEntry_tenantId_professionalId_serviceId_day_phone_key" ON "WaitEntry"("tenantId", "professionalId", "serviceId", "day", "phone");

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_tenantId_professionalId_fkey" FOREIGN KEY ("tenantId", "professionalId") REFERENCES "Professional"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentHistory" ADD CONSTRAINT "AppointmentHistory_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitEntry" ADD CONSTRAINT "WaitEntry_tenantId_professionalId_fkey" FOREIGN KEY ("tenantId", "professionalId") REFERENCES "Professional"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitEntry" ADD CONSTRAINT "WaitEntry_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ScheduleBlock" ADD CHECK ("startsAt" < "endsAt");
