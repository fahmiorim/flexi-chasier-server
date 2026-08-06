-- CreateEnum
CREATE TYPE "StokJenis" AS ENUM ('Bahan', 'Produk');

-- CreateEnum
CREATE TYPE "MutasiRekeningTipe" AS ENUM ('SaldoAwal', 'Pemasukan', 'Penarikan');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "fotoUri" TEXT;

-- CreateTable
CREATE TABLE "PenyesuaianStok" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "jenis" "StokJenis" NOT NULL,
    "entitasId" TEXT NOT NULL,
    "namaEntitas" TEXT,
    "stokSebelum" INTEGER NOT NULL,
    "stokSesudah" INTEGER NOT NULL,
    "selisih" INTEGER NOT NULL,
    "alasan" TEXT,
    "dibuatOleh" TEXT,
    "waktu" TIMESTAMP(3) NOT NULL,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PenyesuaianStok_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MutasiRekening" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "geraiId" TEXT NOT NULL,
    "versi" BIGINT NOT NULL DEFAULT 0,
    "tipe" "MutasiRekeningTipe" NOT NULL,
    "nominal" INTEGER NOT NULL,
    "catatan" TEXT,
    "waktu" TIMESTAMP(3) NOT NULL,
    "dihapus" BOOLEAN NOT NULL DEFAULT false,
    "waktuDiubah" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MutasiRekening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PenyesuaianStok_geraiId_versi_idx" ON "PenyesuaianStok"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "PenyesuaianStok_geraiId_waktu_idx" ON "PenyesuaianStok"("geraiId", "waktu");

-- CreateIndex
CREATE INDEX "MutasiRekening_geraiId_versi_idx" ON "MutasiRekening"("geraiId", "versi");

-- CreateIndex
CREATE INDEX "MutasiRekening_geraiId_waktu_idx" ON "MutasiRekening"("geraiId", "waktu");
