/*
  Warnings:

  - You are about to drop the column `orderId` on the `reviews` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_orderId_fkey";

-- DropIndex
DROP INDEX "reviews_orderId_key";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "reviewId" INTEGER;

-- AlterTable
ALTER TABLE "reviews" DROP COLUMN "orderId";

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
