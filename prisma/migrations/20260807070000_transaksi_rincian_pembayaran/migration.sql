-- AlterTable: simpan rincian pembayaran transaksi agar pull lintas perangkat
-- tidak kehilangan potongan/biaya layanan/pajak (gross vs net tetap konsisten).
ALTER TABLE "Transaction" ADD COLUMN "potongan" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN "biayaLayanan" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN "pajak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'Paid';
ALTER TABLE "Transaction" ADD COLUMN "orderType" TEXT NOT NULL DEFAULT 'DineIn';
ALTER TABLE "Transaction" ADD COLUMN "catatan" TEXT;
