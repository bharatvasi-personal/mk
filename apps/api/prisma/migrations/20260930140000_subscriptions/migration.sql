-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "address_line" TEXT,
    "area" TEXT,
    "plan" TEXT NOT NULL,
    "diet" TEXT NOT NULL,
    "shift" TEXT NOT NULL,
    "days_of_week" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6],
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "paused_from" DATE,
    "paused_to" DATE,
    "skip_dates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amount_minor" INTEGER NOT NULL,
    "price_per_meal_minor" INTEGER,
    "is_paid" BOOLEAN NOT NULL DEFAULT false,
    "paid_on" DATE,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_tenant_id_branch_id_status_idx" ON "subscriptions"("tenant_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_tenant_id_customer_phone_idx" ON "subscriptions"("tenant_id", "customer_phone");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
