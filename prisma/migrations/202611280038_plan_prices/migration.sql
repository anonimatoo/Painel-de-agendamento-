CREATE TABLE "PlanPriceHistory" (
    "priceId" TEXT PRIMARY KEY,
    "planId" TEXT NOT NULL REFERENCES "Plan"(id) ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX "PlanPriceHistory_planId_idx" ON "PlanPriceHistory"("planId");
