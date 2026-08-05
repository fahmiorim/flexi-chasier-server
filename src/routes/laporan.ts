import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { cekAksesGerai } from '../lib/akses-gerai.js';

const router = Router();

router.use(requireAuth);


const rentangSchema = z.object({
  geraiId: z.string().min(1),
  dari: z.coerce.number().int().default(0),
  sampai: z.coerce.number().int().default(() => Date.now()),
});

// ── Penjualan harian ──

router.get('/penjualan-harian', async (req: Request, res) => {
  const parsed = rentangSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, dari, sampai } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const rows = await prisma.$queryRaw<Array<{ tanggal: Date; total: bigint; jumlah: bigint }>>(
    Prisma.sql`
      SELECT DATE_TRUNC('day', waktu) AS tanggal,
             SUM(total)::BIGINT AS total,
             COUNT(*)::BIGINT AS jumlah
      FROM "Transaction"
      WHERE "geraiId" = ${geraiId}
        AND "dibatalkan" = false
        AND waktu >= TO_TIMESTAMP(${Math.floor(dari / 1000)})
        AND waktu <= TO_TIMESTAMP(${Math.floor(sampai / 1000)})
      GROUP BY DATE_TRUNC('day', waktu)
      ORDER BY tanggal ASC
    `,
  );

  return res.json({
    hasil: rows.map((r) => ({
      tanggalEpochMili: new Date(r.tanggal).getTime(),
      total: Number(r.total),
      jumlahTransaksi: Number(r.jumlah),
    })),
  });
});

// ── Rekap kas per shift ──

router.get('/rekap-kas', async (req: Request, res) => {
  const parsed = rentangSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, dari, sampai } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const shifts = await prisma.cashShift.findMany({
    where: {
      geraiId,
      dihapus: false,
      waktuBuka: {
        gte: new Date(dari),
        lte: new Date(sampai),
      },
    },
    orderBy: { waktuBuka: 'asc' },
  });

  const shiftIds = shifts.map((s) => s.id);
  const [mutations, setoran, transactions] = await Promise.all([
    prisma.cashMutation.findMany({
      where: { shiftId: { in: shiftIds }, dihapus: false },
    }),
    prisma.setoran.findMany({
      where: { shiftId: { in: shiftIds }, dihapus: false },
    }),
    prisma.transaction.findMany({
      where: {
        geraiId,
        dihapus: false,
        waktu: { gte: new Date(dari), lte: new Date(sampai) },
      },
    }),
  ]);

  const mutasiPerShift = new Map<string, { pemasukan: number; pengeluaran: number }>();
  for (const m of mutations) {
    const entry = mutasiPerShift.get(m.shiftId) ?? { pemasukan: 0, pengeluaran: 0 };
    if (m.tipe === 'Pemasukan') entry.pemasukan += m.nominal;
    else entry.pengeluaran += m.nominal;
    mutasiPerShift.set(m.shiftId, entry);
  }
  const setoranPerShift = new Map<string, number>();
  for (const s of setoran) {
    setoranPerShift.set(s.shiftId, (setoranPerShift.get(s.shiftId) ?? 0) + s.nominal);
  }

  const hasil = shifts.map((s) => {
    const transaksi = transactions.filter(
      (t) => t.waktu >= s.waktuBuka && (s.waktuTutup === null || t.waktu <= s.waktuTutup),
    );
    const tunai = transaksi
      .filter((t) => t.metodePembayaran === 'Cash')
      .reduce((a, t) => a + t.total, 0);
    const qris = transaksi
      .filter((t) => t.metodePembayaran === 'Qris')
      .reduce((a, t) => a + t.total, 0);
    const m = mutasiPerShift.get(s.id) ?? { pemasukan: 0, pengeluaran: 0 };
    return {
      id: s.id,
      waktuBukaEpochMili: s.waktuBuka.getTime(),
      waktuTutupEpochMili: s.waktuTutup?.getTime() ?? null,
      saldoAwal: s.saldoAwal,
      saldoAkhir: s.saldoAkhir,
      penjualan: tunai + qris,
      penjualanTunai: tunai,
      penjualanQris: qris,
      totalPemasukan: m.pemasukan,
      totalPengeluaran: m.pengeluaran,
      totalSetoran: setoranPerShift.get(s.id) ?? 0,
    };
  });

  return res.json({ hasil });
});

// ── Ringkasan penjualan satu periode ──

router.get('/penjualan-periode', async (req: Request, res) => {
  const parsed = rentangSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, dari, sampai } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const transaksi = await prisma.transaction.findMany({
    where: {
      geraiId,
      dihapus: false,
      dibatalkan: false,
      waktu: { gte: new Date(dari), lte: new Date(sampai) },
    },
    select: { total: true, metodePembayaran: true, jumlahItem: true },
  });

  const totalPenjualan = transaksi.reduce((a, t) => a + t.total, 0);
  const totalTunai = transaksi
    .filter((t) => t.metodePembayaran === 'Cash')
    .reduce((a, t) => a + t.total, 0);
  const totalQris = totalPenjualan - totalTunai;
  const jumlahItem = transaksi.reduce((a, t) => a + t.jumlahItem, 0);
  const jumlahHari = Math.max(1, Math.round((sampai - dari) / 86_400_000) + 1);

  return res.json({
    dariEpochMili: dari,
    sampaiEpochMili: sampai,
    totalPenjualan,
    totalTunai,
    totalQris,
    jumlahTransaksi: transaksi.length,
    jumlahItem,
    jumlahHari,
    rataRataPerHari: Math.round(totalPenjualan / jumlahHari),
  });
});

// ── Produk terlaris ──

const produkTerlarisSchema = rentangSchema.extend({
  limit: z.coerce.number().int().positive().max(50).default(10),
});

router.get('/produk-terlaris', async (req: Request, res) => {
  const parsed = produkTerlarisSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, dari, sampai, limit } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const rows = await prisma.$queryRaw<
    Array<{ productId: string; namaProduk: string; jumlahTerjual: bigint; subtotal: bigint }>
  >(
    Prisma.sql`
      SELECT ti."productId",
             ti."namaProduk",
             SUM(ti.jumlah)::BIGINT AS "jumlahTerjual",
             SUM(ti.subtotal)::BIGINT AS subtotal
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON t.id = ti."transactionId"
      WHERE t."geraiId" = ${geraiId}
        AND t."dibatalkan" = false
        AND t."dihapus" = false
        AND t.waktu >= TO_TIMESTAMP(${Math.floor(dari / 1000)})
        AND t.waktu <= TO_TIMESTAMP(${Math.floor(sampai / 1000)})
      GROUP BY ti."productId", ti."namaProduk"
      ORDER BY "jumlahTerjual" DESC, subtotal DESC
      LIMIT ${limit}
    `,
  );

  return res.json({
    hasil: rows.map((r) => ({
      productId: r.productId,
      namaProduk: r.namaProduk,
      jumlahTerjual: Number(r.jumlahTerjual),
      subtotal: Number(r.subtotal),
    })),
  });
});

// ── Stok produk ──

const stokSchema = z.object({
  geraiId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(2000).default(1000),
  q: z.string().optional(),
  batasMenipis: z.coerce.number().int().nonnegative().default(5),
});

router.get('/stok', async (req: Request, res) => {
  const parsed = stokSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, limit, q, batasMenipis } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const where: Prisma.ProductWhereInput = {
    geraiId,
    dihapus: false,
    aktif: true,
    ...(q ? { nama: { contains: q, mode: 'insensitive' } } : {}),
  };

  const [produk, jumlahProduk, jumlahMenipis] = await Promise.all([
    prisma.product.findMany({
      where,
      select: { id: true, nama: true, kategori: true, stok: true, harga: true },
      orderBy: { stok: 'asc' },
      take: limit,
    }),
    prisma.product.count({ where }),
    prisma.product.count({ where: { ...where, stok: { lte: batasMenipis } } }),
  ]);

  return res.json({ jumlahProduk, jumlahMenipis, hasil: produk });
});

// ── Mutasi kas ──

const mutasiSchema = rentangSchema.extend({
  limit: z.coerce.number().int().positive().max(2000).default(1000),
});

router.get('/mutasi', async (req: Request, res) => {
  const parsed = mutasiSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, dari, sampai, limit } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const where: Prisma.CashMutationWhereInput = {
    geraiId,
    dihapus: false,
    waktu: { gte: new Date(dari), lte: new Date(sampai) },
  };

  const [mutasi, ringkasan] = await Promise.all([
    prisma.cashMutation.findMany({
      where,
      include: { shift: { select: { id: true, waktuBuka: true } } },
      orderBy: { waktu: 'asc' },
      take: limit,
    }),
    prisma.cashMutation.groupBy({
      by: ['tipe'],
      where,
      _sum: { nominal: true },
    }),
  ]);

  const totalPemasukan = ringkasan.find((r) => r.tipe === 'Pemasukan')?._sum.nominal ?? 0;
  const totalPengeluaran = ringkasan.find((r) => r.tipe === 'Pengeluaran')?._sum.nominal ?? 0;

  return res.json({
    totalPemasukan,
    totalPengeluaran,
    hasil: mutasi.map((m) => ({
      id: m.id,
      shiftId: m.shiftId,
      waktuShiftBukaEpochMili: m.shift.waktuBuka.getTime(),
      tipe: m.tipe,
      kategori: m.kategori,
      nominal: m.nominal,
      catatan: m.catatan,
      waktuEpochMili: m.waktu.getTime(),
    })),
  });
});

export default router;
