/*
  Warnings:

  - You are about to drop the column `courierId` on the `courier_locations` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `couriers` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[locationId]` on the table `couriers` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "courier_locations" DROP CONSTRAINT "courier_locations_courierId_fkey";

-- DropForeignKey
ALTER TABLE "couriers" DROP CONSTRAINT "couriers_orderId_fkey";

-- DropIndex
DROP INDEX "courier_locations_courierId_key";

-- DropIndex
DROP INDEX "couriers_orderId_key";

-- AlterTable
ALTER TABLE "courier_locations" DROP COLUMN "courierId";

-- AlterTable
ALTER TABLE "couriers" DROP COLUMN "orderId",
ADD COLUMN     "locationId" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "courierId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "couriers_locationId_key" ON "couriers"("locationId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "courier_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
