ALTER TABLE "Tenant" ADD COLUMN "automaticAppointmentRefunds" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AppointmentRefundRequest" (
    "appointmentId" TEXT PRIMARY KEY REFERENCES "Appointment"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    "accountId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL CHECK ("amount" > 0),
    "includeFee" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeRefundId" TEXT UNIQUE,
    "state" TEXT NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','SUBMITTED','SUCCEEDED','REVIEW'))
);
CREATE INDEX "AppointmentRefundRequest_state_retryAt_idx" ON "AppointmentRefundRequest"(state, "retryAt");

CREATE TABLE "ConnectedRefund" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "appointmentId" TEXT REFERENCES "Appointment"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    "orderId" TEXT REFERENCES "ShopOrder"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    "amount" INTEGER NOT NULL CHECK ("amount" > 0),
    "state" TEXT NOT NULL CHECK (state IN ('pending','requires_action','succeeded','failed','canceled')),
    "succeededAt" TIMESTAMP(3),
    CONSTRAINT "ConnectedRefund_pkey" PRIMARY KEY ("accountId", id),
    CONSTRAINT "ConnectedRefund_owner_check" CHECK (("appointmentId" IS NULL) <> ("orderId" IS NULL))
);
CREATE INDEX "ConnectedRefund_appointmentId_succeededAt_idx" ON "ConnectedRefund"("appointmentId", "succeededAt");
CREATE INDEX "ConnectedRefund_orderId_succeededAt_idx" ON "ConnectedRefund"("orderId", "succeededAt");
