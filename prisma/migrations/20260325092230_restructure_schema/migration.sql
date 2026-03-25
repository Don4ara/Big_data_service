/*
  Warnings:

  - You are about to drop the column `courierId` on the `couriers` table. All the data in the column will be lost.
  - You are about to drop the column `customerId` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `productId` on the `order_items` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `orders` table. All the data in the column will be lost.
  - The primary key for the `restaurants` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `restaurants` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `restaurants` table. All the data in the column will be lost.
  - You are about to drop the `financial_summaries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tax_info` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `working_hours` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `customerId` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `deliveryFee` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `discountAmount` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grandTotal` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentMethod` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `restaurantId` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serviceFee` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subtotal` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `taxAmount` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `end` to the `restaurants` table without a default value. This is not possible if the table is not empty.
  - Added the required column `inn` to the `restaurants` table without a default value. This is not possible if the table is not empty.
  - Added the required column `kpp` to the `restaurants` table without a default value. This is not possible if the table is not empty.
  - Added the required column `start` to the `restaurants` table without a default value. This is not possible if the table is not empty.
  - Added the required column `timeZone` to the `restaurants` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_orderId_fkey";

-- DropForeignKey
ALTER TABLE "financial_summaries" DROP CONSTRAINT "financial_summaries_orderId_fkey";

-- DropForeignKey
ALTER TABLE "restaurants" DROP CONSTRAINT "restaurants_orderId_fkey";

-- DropForeignKey
ALTER TABLE "tax_info" DROP CONSTRAINT "tax_info_restaurantId_fkey";

-- DropForeignKey
ALTER TABLE "working_hours" DROP CONSTRAINT "working_hours_restaurantId_fkey";

-- DropIndex
DROP INDEX "customers_orderId_key";

-- DropIndex
DROP INDEX "orders_orderId_key";

-- DropIndex
DROP INDEX "restaurants_orderId_key";

-- AlterTable
ALTER TABLE "couriers" DROP COLUMN "courierId";

-- AlterTable
ALTER TABLE "customers" DROP COLUMN "customerId",
DROP COLUMN "orderId";

-- AlterTable
ALTER TABLE "order_items" DROP COLUMN "productId";

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "orderId",
ADD COLUMN     "customerId" INTEGER NOT NULL,
ADD COLUMN     "deliveryFee" TEXT NOT NULL,
ADD COLUMN     "discountAmount" TEXT NOT NULL,
ADD COLUMN     "grandTotal" TEXT NOT NULL,
ADD COLUMN     "paymentMethod" TEXT NOT NULL,
ADD COLUMN     "restaurantId" TEXT NOT NULL,
ADD COLUMN     "serviceFee" TEXT NOT NULL,
ADD COLUMN     "subtotal" TEXT NOT NULL,
ADD COLUMN     "taxAmount" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "restaurants" DROP CONSTRAINT "restaurants_pkey",
DROP COLUMN "id",
DROP COLUMN "orderId",
ADD COLUMN     "end" TEXT NOT NULL,
ADD COLUMN     "inn" TEXT NOT NULL,
ADD COLUMN     "kpp" TEXT NOT NULL,
ADD COLUMN     "start" TEXT NOT NULL,
ADD COLUMN     "timeZone" TEXT NOT NULL,
ADD COLUMN     "vatPercent" INTEGER NOT NULL DEFAULT 20,
ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("restaurantId");

-- DropTable
DROP TABLE "financial_summaries";

-- DropTable
DROP TABLE "tax_info";

-- DropTable
DROP TABLE "working_hours";

-- CreateIndex
CREATE INDEX "couriers_name_idx" ON "couriers"("name");

-- CreateIndex
CREATE INDEX "customers_fullName_idx" ON "customers"("fullName");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_email_idx" ON "customers"("email");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_paymentMethod_idx" ON "orders"("paymentMethod");

-- CreateIndex
CREATE INDEX "orders_id_idx" ON "orders"("id" DESC);

-- CreateIndex
CREATE INDEX "restaurants_brandName_idx" ON "restaurants"("brandName");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("restaurantId") ON DELETE RESTRICT ON UPDATE CASCADE;
