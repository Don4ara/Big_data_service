-- CreateTable
CREATE TABLE "geocode_cache" (
    "id" SERIAL NOT NULL,
    "cityKey" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "lat" TEXT NOT NULL,
    "lon" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "geocode_cache_cityKey_key" ON "geocode_cache"("cityKey");
