-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailTerverifikasi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kodeVerifikasiHash" TEXT,
ADD COLUMN     "kodeVerifikasiKadaluarsa" TIMESTAMP(3);
