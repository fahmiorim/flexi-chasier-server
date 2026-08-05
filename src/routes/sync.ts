import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { cekAksesGerai } from '../lib/akses-gerai.js';

const router = Router();

router.use(requireAuth);


/**
 * Upsert idempotent dengan aturan last-write-wins:
 * hanya diterima jika versi baru >= versi yang tersimpan.
 */
async function upsertLww(
  cekVersi: () => Promise<bigint | null>,
  simpan: () => Promise<unknown>,
  versiBaru: number,
): Promise<boolean> {
  const versiLama = await cekVersi();
  if (versiLama !== null && BigInt(versiBaru) < versiLama) {
    return false;
  }
  await simpan();
  return true;
}

// ── PUSH: produk ──

const productSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  nama: z.string().min(1),
  harga: z.number().int().nonnegative(),
  stok: z.number().int().nonnegative().default(0),
  kategori: z.string().nullable().optional(),
  deskripsi: z.string().nullable().optional(),
  favorit: z.boolean().default(false),
  aktif: z.boolean().default(true),
  dihapus: z.boolean().default(false),
});

const pushProdukSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(productSchema).max(500),
});

router.post('/produk', async (req: Request, res) => {
  const parsed = pushProdukSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const masuk = await upsertLww(
        () => tx.product.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.product.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              nama: item.nama,
              harga: item.harga,
              stok: item.stok,
              kategori: item.kategori,
              deskripsi: item.deskripsi,
              favorit: item.favorit,
              aktif: item.aktif,
              dihapus: item.dihapus,
            },
            update: {
              versi: BigInt(item.versi),
              nama: item.nama,
              harga: item.harga,
              stok: item.stok,
              kategori: item.kategori,
              deskripsi: item.deskripsi,
              favorit: item.favorit,
              aktif: item.aktif,
              dihapus: item.dihapus,
            },
          }),
        item.versi,
      );
      if (masuk) diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PUSH: transaksi (+ item) ──

const transaksiItemSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  productId: z.string().min(1),
  namaProduk: z.string().min(1),
  hargaSatuan: z.number().int().nonnegative(),
  jumlah: z.number().int().nonnegative(),
  subtotal: z.number().int().nonnegative(),
});

const transaksiSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  nomor: z.string().min(1),
  waktuEpochMili: z.number().int().nonnegative(),
  metodePembayaran: z.enum(['Cash', 'Qris']),
  jumlahItem: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  dibayar: z.number().int().nonnegative(),
  kembalian: z.number().int().nonnegative(),
  dibatalkan: z.boolean().default(false),
  dibuatOleh: z.string().nullable().optional(),
  dihapus: z.boolean().default(false),
  items: z.array(transaksiItemSchema).max(200).default([]),
});

const pushTransaksiSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(transaksiSchema).max(500),
});

router.post('/transaksi', async (req: Request, res) => {
  const parsed = pushTransaksiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const masuk = await upsertLww(
        () => tx.transaction.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.transaction.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              nomor: item.nomor,
              waktu: new Date(item.waktuEpochMili),
              metodePembayaran: item.metodePembayaran,
              jumlahItem: item.jumlahItem,
              total: item.total,
              dibayar: item.dibayar,
              kembalian: item.kembalian,
              dibatalkan: item.dibatalkan,
              dibuatOleh: item.dibuatOleh ?? req.user.id,
              dihapus: item.dihapus,
            },
            update: {
              versi: BigInt(item.versi),
              nomor: item.nomor,
              waktu: new Date(item.waktuEpochMili),
              metodePembayaran: item.metodePembayaran,
              jumlahItem: item.jumlahItem,
              total: item.total,
              dibayar: item.dibayar,
              kembalian: item.kembalian,
              dibatalkan: item.dibatalkan,
              dibuatOleh: item.dibuatOleh,
              dihapus: item.dihapus,
            },
          }),
        item.versi,
      );
      if (!masuk) continue;

      for (const ti of item.items) {
        await upsertLww(
          () => tx.transactionItem.findUnique({ where: { id: ti.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
          () =>
            tx.transactionItem.upsert({
              where: { id: ti.id },
              create: {
                id: ti.id,
                tenantId: req.user.tenantId,
                geraiId,
                versi: BigInt(ti.versi),
                transactionId: item.id,
                productId: ti.productId,
                namaProduk: ti.namaProduk,
                hargaSatuan: ti.hargaSatuan,
                jumlah: ti.jumlah,
                subtotal: ti.subtotal,
              },
              update: {
                versi: BigInt(ti.versi),
                productId: ti.productId,
                namaProduk: ti.namaProduk,
                hargaSatuan: ti.hargaSatuan,
                jumlah: ti.jumlah,
                subtotal: ti.subtotal,
              },
            }),
          ti.versi,
        );
      }
      diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PUSH: meja ──

const mejaSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  nomor: z.string().min(1),
  aktif: z.boolean().default(true),
  dihapus: z.boolean().default(false),
});

const pushMejaSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(mejaSchema).max(500),
});

router.post('/meja', async (req: Request, res) => {
  const parsed = pushMejaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const masuk = await upsertLww(
        () => tx.table.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.table.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              nomor: item.nomor,
              aktif: item.aktif,
              dihapus: item.dihapus,
            },
            update: {
              versi: BigInt(item.versi),
              nomor: item.nomor,
              aktif: item.aktif,
              dihapus: item.dihapus,
            },
          }),
        item.versi,
      );
      if (masuk) diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PUSH: shift kas ──

const shiftKasSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  waktuBukaEpochMili: z.number().int().nonnegative(),
  waktuTutupEpochMili: z.number().int().nonnegative().nullable().optional(),
  saldoAwal: z.number().int().nonnegative(),
  saldoAkhir: z.number().int().nullable().optional(),
  catatanBuka: z.string().nullable().optional(),
  catatanTutup: z.string().nullable().optional(),
  dibuatOleh: z.string().nullable().optional(),
  dihapus: z.boolean().default(false),
});

const pushShiftKasSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(shiftKasSchema).max(500),
});

router.post('/shift-kas', async (req: Request, res) => {
  const parsed = pushShiftKasSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const masuk = await upsertLww(
        () => tx.cashShift.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.cashShift.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              waktuBuka: new Date(item.waktuBukaEpochMili),
              waktuTutup: item.waktuTutupEpochMili != null ? new Date(item.waktuTutupEpochMili) : null,
              saldoAwal: item.saldoAwal,
              saldoAkhir: item.saldoAkhir ?? null,
              catatanBuka: item.catatanBuka ?? null,
              catatanTutup: item.catatanTutup ?? null,
              dibuatOleh: item.dibuatOleh ?? req.user.id,
              userId: req.user.id,
            },
            update: {
              versi: BigInt(item.versi),
              waktuBuka: new Date(item.waktuBukaEpochMili),
              waktuTutup: item.waktuTutupEpochMili != null ? new Date(item.waktuTutupEpochMili) : null,
              saldoAwal: item.saldoAwal,
              saldoAkhir: item.saldoAkhir ?? null,
              catatanBuka: item.catatanBuka ?? null,
              catatanTutup: item.catatanTutup ?? null,
              dibuatOleh: item.dibuatOleh,
            },
          }),
        item.versi,
      );
      if (masuk) diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PUSH: mutasi kas ──

const mutasiKasSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  shiftId: z.string().min(1),
  tipe: z.enum(['Pemasukan', 'Pengeluaran']),
  kategori: z.string().min(1),
  nominal: z.number().int().nonnegative(),
  catatan: z.string().nullable().optional(),
  waktuEpochMili: z.number().int().nonnegative(),
  dihapus: z.boolean().default(false),
});

const pushMutasiKasSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(mutasiKasSchema).max(500),
});

router.post('/mutasi-kas', async (req: Request, res) => {
  const parsed = pushMutasiKasSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      // Shift harus sudah tersedia di gerai yang sama; jika belum, tunggu batch berikutnya.
      const shiftAda = await tx.cashShift.findFirst({ where: { id: item.shiftId, geraiId }, select: { id: true } });
      if (!shiftAda) continue;

      const masuk = await upsertLww(
        () => tx.cashMutation.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.cashMutation.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              shiftId: item.shiftId,
              tipe: item.tipe,
              kategori: item.kategori,
              nominal: item.nominal,
              catatan: item.catatan ?? null,
              waktu: new Date(item.waktuEpochMili),
              dihapus: item.dihapus,
            },
            update: {
              versi: BigInt(item.versi),
              shiftId: item.shiftId,
              tipe: item.tipe,
              kategori: item.kategori,
              nominal: item.nominal,
              catatan: item.catatan ?? null,
              waktu: new Date(item.waktuEpochMili),
              dihapus: item.dihapus,
            },
          }),
        item.versi,
      );
      if (masuk) diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PUSH: setoran ──

const setoranSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  shiftId: z.string().min(1),
  nominal: z.number().int().nonnegative(),
  catatan: z.string().nullable().optional(),
  waktuEpochMili: z.number().int().nonnegative(),
  dihapus: z.boolean().default(false),
});

const pushSetoranSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(setoranSchema).max(500),
});

router.post('/setoran', async (req: Request, res) => {
  const parsed = pushSetoranSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const shiftAda = await tx.cashShift.findFirst({ where: { id: item.shiftId, geraiId }, select: { id: true } });
      if (!shiftAda) continue;

      const masuk = await upsertLww(
        () => tx.setoran.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.setoran.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              shiftId: item.shiftId,
              nominal: item.nominal,
              catatan: item.catatan ?? null,
              waktu: new Date(item.waktuEpochMili),
              dihapus: item.dihapus,
            },
            update: {
              versi: BigInt(item.versi),
              shiftId: item.shiftId,
              nominal: item.nominal,
              catatan: item.catatan ?? null,
              waktu: new Date(item.waktuEpochMili),
              dihapus: item.dihapus,
            },
          }),
        item.versi,
      );
      if (masuk) diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PUSH: bahan ──

const bahanSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  nama: z.string().min(1),
  satuan: z.string().min(1),
  stok: z.number().int().nonnegative().default(0),
  hargaBeli: z.number().int().nonnegative().default(0),
  stokMinimum: z.number().int().nonnegative().default(0),
  aktif: z.boolean().default(true),
  dihapus: z.boolean().default(false),
});

const pushBahanSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(bahanSchema).max(500),
});

router.post('/bahan', async (req: Request, res) => {
  const parsed = pushBahanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const masuk = await upsertLww(
        () => tx.bahan.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.bahan.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              nama: item.nama,
              satuan: item.satuan,
              stok: item.stok,
              hargaBeli: item.hargaBeli,
              stokMinimum: item.stokMinimum,
              aktif: item.aktif,
              dihapus: item.dihapus,
            },
            update: {
              versi: BigInt(item.versi),
              nama: item.nama,
              satuan: item.satuan,
              stok: item.stok,
              hargaBeli: item.hargaBeli,
              stokMinimum: item.stokMinimum,
              aktif: item.aktif,
              dihapus: item.dihapus,
            },
          }),
        item.versi,
      );
      if (masuk) diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PUSH: pembelian bahan ──

const pembelianBahanSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  bahanId: z.string().min(1),
  namaBahan: z.string().min(1),
  jumlah: z.number().int().nonnegative(),
  hargaTotal: z.number().int().nonnegative(),
  waktuEpochMili: z.number().int().nonnegative(),
  dihapus: z.boolean().default(false),
});

const pushPembelianBahanSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(pembelianBahanSchema).max(500),
});

router.post('/pembelian-bahan', async (req: Request, res) => {
  const parsed = pushPembelianBahanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const masuk = await upsertLww(
        () => tx.pembelianBahan.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.pembelianBahan.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              bahanId: item.bahanId,
              namaBahan: item.namaBahan,
              jumlah: item.jumlah,
              hargaTotal: item.hargaTotal,
              waktu: new Date(item.waktuEpochMili),
              dihapus: item.dihapus,
            },
            update: {
              versi: BigInt(item.versi),
              bahanId: item.bahanId,
              namaBahan: item.namaBahan,
              jumlah: item.jumlah,
              hargaTotal: item.hargaTotal,
              waktu: new Date(item.waktuEpochMili),
              dihapus: item.dihapus,
            },
          }),
        item.versi,
      );
      if (masuk) diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PUSH: resep (+ bahan resep) ──

const resepBahanSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  bahanId: z.string().min(1),
  namaBahan: z.string().min(1),
  jumlah: z.number().int().nonnegative(),
});

const resepSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  productId: z.string().min(1),
  namaProduk: z.string().min(1),
  dihapus: z.boolean().default(false),
  bahan: z.array(resepBahanSchema).max(200).default([]),
});

const pushResepSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(resepSchema).max(500),
});

router.post('/resep', async (req: Request, res) => {
  const parsed = pushResepSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const masuk = await upsertLww(
        () => tx.resep.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.resep.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              productId: item.productId,
              namaProduk: item.namaProduk,
              dihapus: item.dihapus,
            },
            update: {
              versi: BigInt(item.versi),
              productId: item.productId,
              namaProduk: item.namaProduk,
              dihapus: item.dihapus,
            },
          }),
        item.versi,
      );
      if (!masuk) continue;

      for (const rb of item.bahan) {
        await upsertLww(
          () => tx.resepBahan.findUnique({ where: { id: rb.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
          () =>
            tx.resepBahan.upsert({
              where: { id: rb.id },
              create: {
                id: rb.id,
                tenantId: req.user.tenantId,
                geraiId,
                versi: BigInt(rb.versi),
                resepId: item.id,
                bahanId: rb.bahanId,
                namaBahan: rb.namaBahan,
                jumlah: rb.jumlah,
              },
              update: {
                versi: BigInt(rb.versi),
                bahanId: rb.bahanId,
                namaBahan: rb.namaBahan,
                jumlah: rb.jumlah,
              },
            }),
          rb.versi,
        );
      }
      diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PUSH: pengaturan toko ──

const pengaturanTokoSchema = z.object({
  id: z.string().min(1),
  versi: z.number().int().nonnegative(),
  namaUsaha: z.string().min(1),
  alamat: z.string().nullable().optional(),
  tagline: z.string().nullable().optional(),
  logoUri: z.string().nullable().optional(),
});

const pushPengaturanTokoSchema = z.object({
  geraiId: z.string().min(1),
  items: z.array(pengaturanTokoSchema).max(10),
});

router.post('/pengaturan-toko', async (req: Request, res) => {
  const parsed = pushPengaturanTokoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  const { geraiId, items } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  let diterima = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const masuk = await upsertLww(
        () => tx.storeSetting.findUnique({ where: { id: item.id }, select: { versi: true } }).then((r) => r?.versi ?? null),
        () =>
          tx.storeSetting.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              tenantId: req.user.tenantId,
              geraiId,
              versi: BigInt(item.versi),
              namaUsaha: item.namaUsaha,
              alamat: item.alamat ?? null,
              tagline: item.tagline ?? null,
              logoUri: item.logoUri ?? null,
            },
            update: {
              versi: BigInt(item.versi),
              namaUsaha: item.namaUsaha,
              alamat: item.alamat ?? null,
              tagline: item.tagline ?? null,
              logoUri: item.logoUri ?? null,
            },
          }),
        item.versi,
      );
      if (masuk) diterima += 1;
    }
  });

  return res.json({ diterima, total: items.length });
});

// ── PULL: semua entitas (produk, transaksi + item, meja, kas, bahan, resep, pengaturan-toko) ──

const pullSchema = z.object({
  geraiId: z.string().min(1),
  sejakEpochMili: z.coerce.number().int().nonnegative().default(0),
  batas: z.coerce.number().int().positive().max(5000).default(1000),
});

router.get('/perubahan', async (req: Request, res) => {
  const parsed = pullSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, sejakEpochMili, batas } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const sejak = new Date(sejakEpochMili);
  // Ambil satu baris ekstra untuk mendeteksi apakah hasil terpotong (batas terlampaui).
  const batasUji = batas + 1;

  const [
    products,
    transactions,
    tables,
    cashShifts,
    cashMutations,
    setoran,
    bahan,
    pembelianBahan,
    resep,
    storeSettings,
  ] = await Promise.all([
    prisma.product.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
    prisma.transaction.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
    prisma.table.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
    prisma.cashShift.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
    prisma.cashMutation.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
    prisma.setoran.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
    prisma.bahan.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
    prisma.pembelianBahan.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
    prisma.resep.findMany({
      where: { geraiId, waktuDiubah: { gt: sejak } },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
    prisma.storeSetting.findMany({
      where: { geraiId },
      orderBy: { versi: 'asc' },
      take: batasUji,
    }),
  ]);

  // Item transaksi & resepBahan tidak punya waktuDiubah sendiri: ikuti induknya.
  const transactionIds = transactions.map((t) => t.id);
  const transactionItems =
    transactionIds.length > 0
      ? await prisma.transactionItem.findMany({
          where: { transactionId: { in: transactionIds } },
          orderBy: { versi: 'asc' },
          take: Math.max(batasUji, 5001),
        })
      : [];

  const resepIds = resep.map((r) => r.id);
  const resepBahan =
    resepIds.length > 0
      ? await prisma.resepBahan.findMany({
          where: { resepId: { in: resepIds } },
          orderBy: { versi: 'asc' },
          take: Math.max(batasUji, 5001),
        })
      : [];

  // Deteksi truncation lalu potong kembali ke batas sebenarnya.
  const lebihProduk = products.length > batas;
  const lebihTransaksi = transactions.length > batas;
  const lebihItem = transactionItems.length > batas;
  const lebihMeja = tables.length > batas;
  const lebihKas = cashShifts.length > batas;
  const lebihMutasi = cashMutations.length > batas;
  const lebihSetoran = setoran.length > batas;
  const lebihBahan = bahan.length > batas;
  const lebihPembelianBahan = pembelianBahan.length > batas;
  const lebihResep = resep.length > batas;
  const lebihResepBahan = resepBahan.length > batas;
  const lebihStoreSetting = storeSettings.length > batas;

  if (lebihProduk) products.length = batas;
  if (lebihTransaksi) transactions.length = batas;
  if (lebihItem) transactionItems.length = batas;
  if (lebihMeja) tables.length = batas;
  if (lebihKas) cashShifts.length = batas;
  if (lebihMutasi) cashMutations.length = batas;
  if (lebihSetoran) setoran.length = batas;
  if (lebihBahan) bahan.length = batas;
  if (lebihPembelianBahan) pembelianBahan.length = batas;
  if (lebihResep) resep.length = batas;
  if (lebihResepBahan) resepBahan.length = batas;
  if (lebihStoreSetting) storeSettings.length = batas;

  const terpotong =
    lebihProduk ||
    lebihTransaksi ||
    lebihItem ||
    lebihMeja ||
    lebihKas ||
    lebihMutasi ||
    lebihSetoran ||
    lebihBahan ||
    lebihPembelianBahan ||
    lebihResep ||
    lebihResepBahan ||
    lebihStoreSetting;

  return res.json({
    waktuServerEpochMili: Date.now(),
    terpotong,
    products: products.map((p) => ({
      id: p.id,
      versi: Number(p.versi),
      nama: p.nama,
      harga: p.harga,
      stok: p.stok,
      kategori: p.kategori,
      deskripsi: p.deskripsi,
      favorit: p.favorit,
      aktif: p.aktif,
      dihapus: p.dihapus,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      versi: Number(t.versi),
      nomor: t.nomor,
      waktuEpochMili: t.waktu.getTime(),
      metodePembayaran: t.metodePembayaran,
      jumlahItem: t.jumlahItem,
      total: t.total,
      dibayar: t.dibayar,
      kembalian: t.kembalian,
      dibatalkan: t.dibatalkan,
      dibuatOleh: t.dibuatOleh,
      dihapus: t.dihapus,
    })),
    transactionItems: transactionItems.map((ti) => ({
      id: ti.id,
      versi: Number(ti.versi),
      transactionId: ti.transactionId,
      productId: ti.productId,
      namaProduk: ti.namaProduk,
      hargaSatuan: ti.hargaSatuan,
      jumlah: ti.jumlah,
      subtotal: ti.subtotal,
    })),
    tables: tables.map((t) => ({
      id: t.id,
      versi: Number(t.versi),
      nomor: t.nomor,
      aktif: t.aktif,
      dihapus: t.dihapus,
    })),
    cashShifts: cashShifts.map((s) => ({
      id: s.id,
      versi: Number(s.versi),
      waktuBukaEpochMili: s.waktuBuka.getTime(),
      waktuTutupEpochMili: s.waktuTutup?.getTime() ?? null,
      saldoAwal: s.saldoAwal,
      saldoAkhir: s.saldoAkhir,
      catatanBuka: s.catatanBuka,
      catatanTutup: s.catatanTutup,
      dibuatOleh: s.dibuatOleh,
      userId: s.userId,
      dihapus: s.dihapus,
    })),
    cashMutations: cashMutations.map((m) => ({
      id: m.id,
      versi: Number(m.versi),
      shiftId: m.shiftId,
      tipe: m.tipe,
      kategori: m.kategori,
      nominal: m.nominal,
      catatan: m.catatan,
      waktuEpochMili: m.waktu.getTime(),
      dihapus: m.dihapus,
    })),
    setoran: setoran.map((s) => ({
      id: s.id,
      versi: Number(s.versi),
      shiftId: s.shiftId,
      nominal: s.nominal,
      catatan: s.catatan,
      waktuEpochMili: s.waktu.getTime(),
      dihapus: s.dihapus,
    })),
    bahan: bahan.map((b) => ({
      id: b.id,
      versi: Number(b.versi),
      nama: b.nama,
      satuan: b.satuan,
      stok: b.stok,
      hargaBeli: b.hargaBeli,
      stokMinimum: b.stokMinimum,
      aktif: b.aktif,
      dihapus: b.dihapus,
    })),
    pembelianBahan: pembelianBahan.map((p) => ({
      id: p.id,
      versi: Number(p.versi),
      bahanId: p.bahanId,
      namaBahan: p.namaBahan,
      jumlah: p.jumlah,
      hargaTotal: p.hargaTotal,
      waktuEpochMili: p.waktu.getTime(),
      dihapus: p.dihapus,
    })),
    resep: resep.map((r) => ({
      id: r.id,
      versi: Number(r.versi),
      productId: r.productId,
      namaProduk: r.namaProduk,
      dihapus: r.dihapus,
    })),
    resepBahan: resepBahan.map((rb) => ({
      id: rb.id,
      versi: Number(rb.versi),
      resepId: rb.resepId,
      bahanId: rb.bahanId,
      namaBahan: rb.namaBahan,
      jumlah: rb.jumlah,
    })),
    storeSettings: storeSettings.map((s) => ({
      id: s.id,
      versi: Number(s.versi),
      namaUsaha: s.namaUsaha,
      alamat: s.alamat,
      tagline: s.tagline,
      logoUri: s.logoUri,
    })),
  });
});

export default router;
