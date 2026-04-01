-- AlterTable: rating Int → Float (поддержка 0.5, 1.5, 2.5 и т.д.)
ALTER TABLE "reviews" ALTER COLUMN "rating" SET DATA TYPE DOUBLE PRECISION;
