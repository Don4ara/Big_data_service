-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderDate" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "status" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_addresses" (
    "id" SERIAL NOT NULL,
    "city" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "building" TEXT NOT NULL,
    "apartment" TEXT NOT NULL,
    "entrance" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "intercom" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "deliveryTimeZone" TEXT,
    "customerId" INTEGER NOT NULL,

    CONSTRAINT "delivery_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coordinates" (
    "id" SERIAL NOT NULL,
    "lat" TEXT NOT NULL,
    "lon" TEXT NOT NULL,
    "deliveryAddressId" INTEGER NOT NULL,

    CONSTRAINT "coordinates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurants" (
    "id" SERIAL NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "legalEntity" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_info" (
    "id" SERIAL NOT NULL,
    "inn" TEXT NOT NULL,
    "kpp" TEXT NOT NULL,
    "vatPercent" INTEGER NOT NULL DEFAULT 20,
    "restaurantId" INTEGER NOT NULL,

    CONSTRAINT "tax_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" SERIAL NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "restaurantId" INTEGER NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "pricePerUnit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "specialInstructions" TEXT,
    "orderId" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_options" (
    "id" SERIAL NOT NULL,
    "numberOfCutlery" INTEGER NOT NULL,
    "requiresContactlessDelivery" BOOLEAN NOT NULL,
    "isEcoFriendlyPackaging" BOOLEAN NOT NULL,
    "orderId" INTEGER NOT NULL,

    CONSTRAINT "order_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "couriers" (
    "id" SERIAL NOT NULL,
    "courierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transportType" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "estimatedArrival" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_locations" (
    "id" SERIAL NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "courierId" INTEGER NOT NULL,

    CONSTRAINT "courier_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_summaries" (
    "id" SERIAL NOT NULL,
    "subtotal" TEXT NOT NULL,
    "taxAmount" TEXT NOT NULL,
    "deliveryFee" TEXT NOT NULL,
    "serviceFee" TEXT NOT NULL,
    "discountAmount" TEXT NOT NULL,
    "grandTotal" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,

    CONSTRAINT "financial_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" SERIAL NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderId_key" ON "orders"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_orderId_key" ON "customers"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_addresses_customerId_key" ON "delivery_addresses"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "coordinates_deliveryAddressId_key" ON "coordinates"("deliveryAddressId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_orderId_key" ON "restaurants"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_info_restaurantId_key" ON "tax_info"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "working_hours_restaurantId_key" ON "working_hours"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "order_options_orderId_key" ON "order_options"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "couriers_orderId_key" ON "couriers"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "courier_locations_courierId_key" ON "courier_locations"("courierId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_summaries_orderId_key" ON "financial_summaries"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_orderId_key" ON "reviews"("orderId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_addresses" ADD CONSTRAINT "delivery_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordinates" ADD CONSTRAINT "coordinates_deliveryAddressId_fkey" FOREIGN KEY ("deliveryAddressId") REFERENCES "delivery_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_info" ADD CONSTRAINT "tax_info_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_options" ADD CONSTRAINT "order_options_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_locations" ADD CONSTRAINT "courier_locations_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_summaries" ADD CONSTRAINT "financial_summaries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
