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

/**
 * HPP (harga pokok) per produk = Σ jumlah bahan dalam resep × hargaBeli bahan.
 * Dihitung dari data bahan & resep TERKINI (bukan snapshot per transaksi),
 * jadi perubahan harga beli tercermin di laporan berikutnya.
 */
async function hppPerProduk(geraiId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ productId: string; hpp: bigint }>>(
    Prisma.sql`
      SELECT r."productId",
             SUM(rb.jumlah * b."hargaBeli")::BIGINT AS hpp
      FROM "ResepBahan" rb
      JOIN "Resep" r ON r.id = rb."resepId"
      JOIN "Bahan" b ON b.id = rb."bahanId"
      WHERE r."geraiId" = ${geraiId}
        AND r."dihapus" = false
        AND b."dihapus" = false
      GROUP BY r."productId"
    `,
  );
  return new Map(rows.map((r) => [r.productId, Number(r.hpp)]));
}

/** Peta id user → nama untuk audit trail "dibuat oleh". */
async function petaNamaUser(tenantId: string): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ where: { tenantId }, select: { id: true, nama: true } });
  return new Map(users.map((u) => [u.id, u.nama]));
}

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
        AND "dihapus" = false
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
        dibatalkan: false,
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

  const hasil = shifts.map((s, i) => {
    // Batas akhir shift = waktu tutup, atau waktu buka shift berikutnya bila
    // shift ini masih menggantung (waktuTutup null). Tanpa ini, transaksi
    // setelah shift berikutnya dibuka ikut dihitung ke DUA shift sekaligus.
    const batasAkhir = s.waktuTutup ?? shifts[i + 1]?.waktuBuka ?? null;
    const transaksi = transactions.filter(
      (t) => t.waktu >= s.waktuBuka && (batasAkhir === null || t.waktu <= batasAkhir),
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
      catatanBuka: s.catatanBuka,
      catatanTutup: s.catatanTutup,
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

  const [transaksi, itemTerjual, hppMap] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        geraiId,
        dihapus: false,
        dibatalkan: false,
        waktu: { gte: new Date(dari), lte: new Date(sampai) },
      },
      select: { total: true, metodePembayaran: true, jumlahItem: true },
    }),
    prisma.transactionItem.findMany({
      where: {
        geraiId,
        transaction: {
          geraiId,
          dihapus: false,
          dibatalkan: false,
          waktu: { gte: new Date(dari), lte: new Date(sampai) },
        },
      },
      select: { productId: true, jumlah: true },
    }),
    hppPerProduk(geraiId),
  ]);

  const totalPenjualan = transaksi.reduce((a, t) => a + t.total, 0);
  const totalTunai = transaksi
    .filter((t) => t.metodePembayaran === 'Cash')
    .reduce((a, t) => a + t.total, 0);
  const totalQris = totalPenjualan - totalTunai;
  const jumlahItem = transaksi.reduce((a, t) => a + t.jumlahItem, 0);
  const totalHpp = itemTerjual.reduce(
    (a, ti) => a + (hppMap.get(ti.productId) ?? 0) * ti.jumlah,
    0,
  );
  const labaKotor = totalPenjualan - totalHpp;
  const jumlahHari = Math.max(1, Math.round((sampai - dari) / 86_400_000));

  return res.json({
    dariEpochMili: dari,
    sampaiEpochMili: sampai,
    totalPenjualan,
    totalTunai,
    totalQris,
    jumlahTransaksi: transaksi.length,
    jumlahItem,
    totalHpp,
    labaKotor,
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

  const [produk, jumlahProduk, jumlahMenipis, hppMap] = await Promise.all([
    prisma.product.findMany({
      where,
      select: { id: true, nama: true, kategori: true, stok: true, harga: true },
      orderBy: { stok: 'asc' },
      take: limit,
    }),
    prisma.product.count({ where }),
    prisma.product.count({ where: { ...where, stok: { lte: batasMenipis } } }),
    hppPerProduk(geraiId),
  ]);

  return res.json({
    jumlahProduk,
    jumlahMenipis,
    hasil: produk.map((p) => ({
      id: p.id,
      nama: p.nama,
      kategori: p.kategori,
      stok: p.stok,
      harga: p.harga,
      hpp: hppMap.get(p.id) ?? 0,
    })),
  });
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
  const namaUser = await petaNamaUser(req.user.tenantId);

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
      dibuatOleh: m.dibuatOleh,
      dibuatOlehNama: m.dibuatOleh ? namaUser.get(m.dibuatOleh) ?? null : null,
      waktuEpochMili: m.waktu.getTime(),
    })),
  });
});


// ── Daftar setoran kas ──

router.get('/setoran', async (req: Request, res) => {
  const parsed = mutasiSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, dari, sampai, limit } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const setoran = await prisma.setoran.findMany({
    where: {
      geraiId,
      dihapus: false,
      waktu: { gte: new Date(dari), lte: new Date(sampai) },
    },
    include: { shift: { select: { id: true, waktuBuka: true } } },
    orderBy: { waktu: 'asc' },
    take: limit,
  });

  const namaUser = await petaNamaUser(req.user.tenantId);

  return res.json({
    hasil: setoran.map((st) => ({
      id: st.id,
      shiftId: st.shiftId,
      waktuShiftBukaEpochMili: st.shift.waktuBuka.getTime(),
      nominal: st.nominal,
      catatan: st.catatan,
      dibuatOleh: st.dibuatOleh,
      dibuatOlehNama: st.dibuatOleh ? namaUser.get(st.dibuatOleh) ?? null : null,
      waktuEpochMili: st.waktu.getTime(),
    })),
  });
});

// ── Rekap rekening ──

const rekeningSchema = rentangSchema.extend({
  limit: z.coerce.number().int().positive().max(2000).default(1000),
});

router.get('/rekening', async (req: Request, res) => {
  const parsed = rekeningSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, dari, sampai, limit } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const [saldoAwalRecord, mutasi, ringkasan, setoran, qris] = await Promise.all([
    prisma.mutasiRekening.findFirst({
      where: { geraiId, dihapus: false, tipe: 'SaldoAwal' },
      orderBy: { waktu: 'desc' },
    }),
    prisma.mutasiRekening.findMany({
      where: {
        geraiId,
        dihapus: false,
        tipe: { in: ['Pemasukan', 'Penarikan'] },
        waktu: { gte: new Date(dari), lte: new Date(sampai) },
      },
      orderBy: { waktu: 'asc' },
      take: limit,
    }),
    prisma.mutasiRekening.groupBy({
      by: ['tipe'],
      where: {
        geraiId,
        dihapus: false,
        tipe: { in: ['Pemasukan', 'Penarikan'] },
        waktu: { gte: new Date(dari), lte: new Date(sampai) },
      },
      _sum: { nominal: true },
    }),
    prisma.setoran.findMany({
      where: { geraiId, dihapus: false, waktu: { gte: new Date(dari), lte: new Date(sampai) } },
      select: { nominal: true },
    }),
    prisma.transaction.aggregate({
      where: {
        geraiId,
        dihapus: false,
        dibatalkan: false,
        metodePembayaran: 'Qris',
        waktu: { gte: new Date(dari), lte: new Date(sampai) },
      },
      _sum: { total: true },
    }),
  ]);

  const saldoAwal = saldoAwalRecord?.nominal ?? 0;
  const totalPemasukan = ringkasan.find((r) => r.tipe === 'Pemasukan')?._sum.nominal ?? 0;
  const totalPenarikan = ringkasan.find((r) => r.tipe === 'Penarikan')?._sum.nominal ?? 0;
  const totalSetoran = setoran.reduce((a, s) => a + s.nominal, 0);
  const totalPenjualanQris = qris._sum.total ?? 0;
  const saldoAkhir = saldoAwal + totalSetoran + totalPenjualanQris + totalPemasukan - totalPenarikan;

  return res.json({
    saldoAwal,
    totalSetoran,
    totalPenjualanQris,
    totalPemasukan,
    totalPenarikan,
    saldoAkhir,
    mutasi: mutasi.map((m) => ({
      id: m.id,
      tipe: m.tipe,
      nominal: m.nominal,
      catatan: m.catatan,
      waktuEpochMili: m.waktu.getTime(),
    })),
  });
});

// ── Riwayat penyesuaian stok ──

const penyesuaianSchema = rentangSchema.extend({
  limit: z.coerce.number().int().positive().max(2000).default(1000),
  jenis: z.enum(['Bahan', 'Produk']).optional(),
  entitasId: z.string().optional(),
});

router.get('/penyesuaian-stok', async (req: Request, res) => {
  const parsed = penyesuaianSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Parameter tidak valid' });
  }
  const { geraiId, dari, sampai, limit, jenis, entitasId } = parsed.data;
  if (!(await cekAksesGerai(req, geraiId))) {
    return res.status(403).json({ error: 'Tidak punya akses ke gerai ini' });
  }

  const where: Prisma.PenyesuaianStokWhereInput = {
    geraiId,
    dihapus: false,
    waktu: { gte: new Date(dari), lte: new Date(sampai) },
    ...(jenis ? { jenis } : {}),
    ...(entitasId ? { entitasId } : {}),
  };

  const [riwayat, jumlah] = await Promise.all([
    prisma.penyesuaianStok.findMany({
      where,
      orderBy: { waktu: 'desc' },
      take: limit,
    }),
    prisma.penyesuaianStok.count({ where }),
  ]);
  const namaUser = await petaNamaUser(req.user.tenantId);

  return res.json({
    jumlah,
    hasil: riwayat.map((p) => ({
      id: p.id,
      jenis: p.jenis,
      entitasId: p.entitasId,
      namaEntitas: p.namaEntitas,
      stokSebelum: p.stokSebelum,
      stokSesudah: p.stokSesudah,
      selisih: p.selisih,
      alasan: p.alasan,
      dibuatOleh: p.dibuatOleh,
      dibuatOlehNama: p.dibuatOleh ? namaUser.get(p.dibuatOleh) ?? null : null,
      waktuEpochMili: p.waktu.getTime(),
    })),
  });
});

export default router;
