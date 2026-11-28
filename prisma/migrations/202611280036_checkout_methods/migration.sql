CREATE TYPE "CheckoutMethod" AS ENUM ('card', 'pix');
ALTER TABLE "Tenant" ADD COLUMN "pixCheckoutEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN "checkoutMethod" "CheckoutMethod" NOT NULL DEFAULT 'card';
ALTER TABLE "ShopOrder" ADD COLUMN "checkoutMethod" "CheckoutMethod" NOT NULL DEFAULT 'card';
