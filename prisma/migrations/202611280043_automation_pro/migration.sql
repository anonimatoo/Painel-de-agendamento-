CREATE UNIQUE INDEX "Appointment_tenantId_id_key" ON "Appointment"("tenantId","id");

CREATE TABLE "AutomationRule" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "graph" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "AutomationRule_tenantId_id_key" ON "AutomationRule"("tenantId","id");
CREATE INDEX "AutomationRule_tenantId_enabled_trigger_idx" ON "AutomationRule"("tenantId","enabled","trigger");

CREATE TABLE "AutomationRun" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "trigger" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "state" TEXT NOT NULL DEFAULT 'QUEUED',
  "reminderId" TEXT REFERENCES "Reminder"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AutomationRun_tenantId_ruleId_fkey" FOREIGN KEY ("tenantId","ruleId") REFERENCES "AutomationRule"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AutomationRun_tenantId_appointmentId_fkey" FOREIGN KEY ("tenantId","appointmentId") REFERENCES "Appointment"("tenantId","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AutomationRun_ruleId_revision_appointmentId_startsAt_trigger_key" ON "AutomationRun"("ruleId","revision","appointmentId","startsAt","trigger");
CREATE INDEX "AutomationRun_state_createdAt_idx" ON "AutomationRun"("state","createdAt");
CREATE INDEX "AutomationRun_tenantId_createdAt_idx" ON "AutomationRun"("tenantId","createdAt");
CREATE INDEX "AutomationRun_reminderId_idx" ON "AutomationRun"("reminderId");
