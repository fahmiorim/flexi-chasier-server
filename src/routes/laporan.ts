import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

async function cekAksesGerai(req: Request, geraiId: string): Promise<boolean> {
  if (req.user.peran === 'Pemilik') {
    const gerai = await prisma.gerai.findFirst({
      where: { id: geraiId, tenantId: req.user.tenantId },
    });
    return gerai !== null;
  }
  const relasi = await prisma.userGerai.findUnique({
    where: { userId_geraiId: { userId: req.user.id, geraiId } },
  });
  return relasi !== null;
}

const rentangSchema = z.object({
  geraiId: z.string().min(1),
  dari: z.coerce.number().int().default(0),
  sampai: z.coerce.number().int().default(() => Date.now()),
});

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
      where: { geraiId, dihapus: false },
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
    const transaksi = transactions.filter((t) => t.waktu >= s.waktuBuka && (s.waktuTutup === null || t.waktu <= s.waktuTutup));
    const tunai = transaksi.filter((t) => t.metodePembayaran === 'Cash').reduce((a, t) => a + t.total, 0);
    const qris = transaksi.filter((t) => t.metodePembayaran === 'Qris').reduce((a, t) => a + t.total, 0);
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

export default router;
