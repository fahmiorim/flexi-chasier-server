-- CreateEnum
CREATE TYPE "Peran" AS ENUM ('Pemilik', 'Kasir');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('Cash', 'Qris');

-- CreateEnum
CREATE TYPE "KasStatus" AS ENUM ('Aktif', 'Selesai');

-- CreateEnum
CREATE TYPE "MutasiTipe" AS ENUM ('Pemasukan', 'Pengeluaran');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "waktuDibuat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "peran" "Peran" NOT NULL DEFAULT 'Kasir',
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "waktuDibuat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gerai" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "alamat" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "waktuDibuat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gerai_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGerai" (
    "userId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,

    CONSTRAINT "UserGerai_pkey" PRIMARY KEY ("userId","geraiId")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "nama" TEXT NOT NULL,
    "harga" INTEGER NOT NULL,
    "stok" INTEGER NOT NULL DEFAULT 0,
    "kategori" TEXT,
    "deskripsi" TEXT,
    "favorit" BOOLEAN NOT NULL DEFAULT false,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDibuat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "nomor" TEXT NOT NULL,
    "waktu" TIMESTAMP(3) NOT NULL,
    "metodePembayaran" "PaymentMethod" NOT NULL,
    "jumlahItem" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "dibayar" INTEGER NOT NULL,
    "kembalian" INTEGER NOT NULL,
    "dibatalkan" BOOLEAN NOT NULL DEFAULT false,
    "dibuatOleh" TEXT,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "transactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "namaProduk" TEXT NOT NULL,
    "hargaSatuan" INTEGER NOT NULL,
    "jumlah" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,

    CONSTRAINT "TransactionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "nomor" TEXT NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "waktuBuka" TIMESTAMP(3) NOT NULL,
    "waktuTutup" TIMESTAMP(3),
    "saldoAwal" INTEGER NOT NULL,
    "saldoAkhir" INTEGER,
    "catatanBuka" TEXT,
    "catatanTutup" TEXT,
    "dibuatOleh" TEXT,
    "userId" TEXT,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMutation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "shiftId" TEXT NOT NULL,
    "tipe" "MutasiTipe" NOT NULL,
    "kategori" TEXT NOT NULL,
    "nominal" INTEGER NOT NULL,
    "catatan" TEXT,
    "waktu" TIMESTAMP(3) NOT NULL,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setoran" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "shiftId" TEXT NOT NULL,
    "nominal" INTEGER NOT NULL,
    "catatan" TEXT,
    "waktu" TIMESTAMP(3) NOT NULL,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setoran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bahan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "nama" TEXT NOT NULL,
    "satuan" TEXT NOT NULL,
    "stok" INTEGER NOT NULL DEFAULT 0,
    "hargaBeli" INTEGER NOT NULL,
    "stokMinimum" INTEGER NOT NULL DEFAULT 0,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bahan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PembelianBahan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "bahanId" TEXT NOT NULL,
    "namaBahan" TEXT NOT NULL,
    "jumlah" INTEGER NOT NULL,
    "hargaTotal" INTEGER NOT NULL,
    "waktu" TIMESTAMP(3) NOT NULL,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PembelianBahan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,
    "namaProduk" TEXT NOT NULL,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResepBahan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "resepId" TEXT NOT NULL,
    "bahanId" TEXT NOT NULL,
    "namaBahan" TEXT NOT NULL,
    "jumlah" INTEGER NOT NULL,

    CONSTRAINT "ResepBahan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "namaUsaha" TEXT NOT NULL,
    "alamat" TEXT,
    "tagline" TEXT,
    "logoUri" TEXT,

    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "entitas" TEXT NOT NULL,
    "waktuSinkron" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("tenantId","geraiId","entitas")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "Gerai_tenantId_idx" ON "Gerai"("tenantId");

-- CreateIndex
CREATE INDEX "Product_tenantId_geraiId_idx" ON "Product"("tenantId", "geraiId");

-- CreateIndex
CREATE INDEX "Product_geraiId_versi_idx" ON "Product"("geraiId", "versi");

-- CreateIndex
CREATE UNIQUE INDEX "Product_geraiId_id_key" ON "Product"("geraiId", "id");

-- CreateIndex
CREATE INDEX "Transaction_tenantId_geraiId_waktu_idx" ON "Transaction"("tenantId", "geraiId", "waktu");

-- CreateIndex
CREATE INDEX "Transaction_geraiId_versi_idx" ON "Transaction"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "TransactionItem_transactionId_idx" ON "TransactionItem"("transactionId");

-- CreateIndex
CREATE INDEX "Table_tenantId_geraiId_idx" ON "Table"("tenantId", "geraiId");

-- CreateIndex
CREATE INDEX "Table_geraiId_versi_idx" ON "Table"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "CashShift_tenantId_geraiId_idx" ON "CashShift"("tenantId", "geraiId");

-- CreateIndex
CREATE INDEX "CashShift_geraiId_versi_idx" ON "CashShift"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "CashMutation_shiftId_idx" ON "CashMutation"("shiftId");

-- CreateIndex
CREATE INDEX "CashMutation_geraiId_versi_idx" ON "CashMutation"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "Setoran_shiftId_idx" ON "Setoran"("shiftId");

-- CreateIndex
CREATE INDEX "Setoran_geraiId_versi_idx" ON "Setoran"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "Bahan_tenantId_geraiId_idx" ON "Bahan"("tenantId", "geraiId");

-- CreateIndex
CREATE INDEX "Bahan_geraiId_versi_idx" ON "Bahan"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "PembelianBahan_geraiId_versi_idx" ON "PembelianBahan"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "Resep_geraiId_versi_idx" ON "Resep"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "ResepBahan_resepId_idx" ON "ResepBahan"("resepId");

-- CreateIndex
CREATE INDEX "StoreSetting_tenantId_geraiId_idx" ON "StoreSetting"("tenantId", "geraiId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSetting_geraiId_id_key" ON "StoreSetting"("geraiId", "id");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gerai" ADD CONSTRAINT "Gerai_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGerai" ADD CONSTRAINT "UserGerai_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGerai" ADD CONSTRAINT "UserGerai_geraiId_fkey" FOREIGN KEY ("geraiId") REFERENCES "Gerai"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_geraiId_fkey" FOREIGN KEY ("geraiId") REFERENCES "Gerai"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionItem" ADD CONSTRAINT "TransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMutation" ADD CONSTRAINT "CashMutation_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setoran" ADD CONSTRAINT "Setoran_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResepBahan" ADD CONSTRAINT "ResepBahan_resepId_fkey" FOREIGN KEY ("resepId") REFERENCES "Resep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
