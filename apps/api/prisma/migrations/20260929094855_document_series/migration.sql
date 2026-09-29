-- DropIndex
DROP INDEX "invoice_sequences_branch_id_fy_key";

-- AlterTable
ALTER TABLE "invoice_sequences" ADD COLUMN     "series" TEXT NOT NULL DEFAULT 'INV';

-- CreateIndex
CREATE UNIQUE INDEX "invoice_sequences_branch_id_fy_series_key" ON "invoice_sequences"("branch_id", "fy", "series");

